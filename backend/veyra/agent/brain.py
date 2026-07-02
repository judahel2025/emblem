"""Provider-agnostic LLM brain.

Dispatch chain (all free):
  Text tasks:  Cerebras key-1 → Cerebras key-2 → Groq → friendly error
  Tool calls:  same 3-key cascade (all OpenAI-compatible)
  Vision:      Gemini 1.5 Flash (free tier, inline base64 image)
  Embeddings:  Gemini text-embedding-004 (free tier)

Keys live in the DPAPI vault. Raw httpx per provider — no SDKs, stays
dependency-light. The function signatures are unchanged so callers don't break.
"""

import time

import httpx

from ..kernel import config, vault

DEFAULT_MODEL = {
    "cerebras": "gpt-oss-120b",
    "groq":     "llama-3.3-70b-versatile",
    "claude":   "claude-opus-4-8",
    "openai":   "gpt-4o",
    "gemini":   "gemini-2.0-flash",
}
KEY_NAME = {
    "cerebras": "cerebras_key",
    "groq":     "groq_key",
    "claude":   "anthropic_key",
    "openai":   "openai_key",
    "gemini":   "gemini_key",
}
LABEL = {
    "cerebras": "Cerebras",
    "groq":     "Groq (llama-3.3-70b)",
    "claude":   "Claude (Anthropic)",
    "openai":   "OpenAI",
    "gemini":   "Google Gemini",
}

DEFAULT_SYSTEM = (
    "You are Veyra — Master Judah's personal AI assistant. "
    "You are warm, direct, decisive, and authentic. "
    "You speak as a trusted advisor: honest about what you know, clear about what you don't, "
    "and always in service of Master Judah's goals. "
    "You form real opinions when asked, reason through problems step by step, "
    "and give concrete recommendations rather than vague options. "
    "Keep replies tight unless depth is needed. "
    "Never be robotic or corporate. "
    "When you search the web or read a document, synthesise what you found — "
    "don't just list raw results. "
    "If asked how you are, say you're doing great."
)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def get_config():
    p = config.get("brain_provider", "cerebras")
    return {
        "provider": p,
        "model": config.get(f"brain_model_{p}", DEFAULT_MODEL.get(p, "")),
        "defaults": DEFAULT_MODEL,
        "labels": LABEL,
    }


def set_config(provider=None, model=None):
    if provider:
        config.set("brain_provider", provider)
    p = provider or config.get("brain_provider", "cerebras")
    if model:
        config.set(f"brain_model_{p}", model)
    return get_config()


def _has_key(p):
    return bool(vault.get_secret(KEY_NAME.get(p, "")))


def status():
    p = config.get("brain_provider", "cerebras")
    return {
        "provider": p,
        "label":    LABEL.get(p, p),
        "model":    config.get(f"brain_model_{p}", DEFAULT_MODEL.get(p)),
        "ready":    _has_key(p),
    }


def supports_tools():
    """True when at least one OpenAI-compatible tool-calling key is available."""
    return any(
        vault.get_secret(k)
        for k in ("cerebras_key", "cerebras_key_2", "groq_key", "openai_key")
    )


# ---------------------------------------------------------------------------
# Message helpers
# ---------------------------------------------------------------------------

def _messages(prompt, history):
    msgs = []
    for h in (history or []):
        role    = h.get("role")
        content = h.get("content") or h.get("text") or ""
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": prompt})
    return msgs


# ---------------------------------------------------------------------------
# Public: text chat
# ---------------------------------------------------------------------------

def chat(prompt, system=None, history=None, fmt=None, max_tokens=1024):
    p   = config.get("brain_provider", "cerebras")
    model = config.get(f"brain_model_{p}", DEFAULT_MODEL.get(p))
    sys_  = system or DEFAULT_SYSTEM
    key   = vault.get_secret(KEY_NAME.get(p, ""))

    if not key:
        return {
            "ok": False,
            "reply": f"No {LABEL.get(p, p)} API key yet — add it in Settings → AI brain.",
            "error": "no_key",
        }

    msgs = _messages(prompt, history)
    try:
        if p == "cerebras":
            result = _cerebras(model, sys_, msgs, key, fmt, max_tokens)
            if not result["ok"]:
                result = _cerebras_fallback(model, sys_, msgs, fmt, max_tokens)
            return result
        if p == "groq":
            return _groq(model, sys_, msgs, key, fmt, max_tokens)
        if p == "claude":
            return _claude(model, sys_, msgs, key, fmt, max_tokens)
        if p == "openai":
            return _openai(model, sys_, msgs, key, fmt, max_tokens)
        if p == "gemini":
            return _gemini(model, sys_, msgs, key, fmt, max_tokens)
    except Exception as exc:
        # Never name the provider or leak the raw error to the client.
        import logging as _lg
        _lg.getLogger("veyra.brain").warning("provider %s failed: %s", p, exc)
        return {"ok": False, "reply": "I couldn't complete that just now — give me a moment and try again.", "error": "unavailable"}
    return {"ok": False, "reply": "I couldn't complete that just now — give me a moment and try again.", "error": "unavailable"}


# ---------------------------------------------------------------------------
# Public: tool-calling (OpenAI-compatible cascade)
# ---------------------------------------------------------------------------

def chat_tools(messages, tools, max_tokens=2048):
    """Tool-calling turn.  Tries 3 providers in order; never surfaces a raw HTTP error."""
    candidates = [
        ("cerebras_key",   "https://api.cerebras.ai/v1/chat/completions",    DEFAULT_MODEL["cerebras"],  True),
        ("cerebras_key_2", "https://api.cerebras.ai/v1/chat/completions",    DEFAULT_MODEL["cerebras"],  True),
        ("groq_key",       "https://api.groq.com/openai/v1/chat/completions", DEFAULT_MODEL["groq"],     False),
        ("openai_key",     "https://api.openai.com/v1/chat/completions",      DEFAULT_MODEL["openai"],   False),
    ]
    for key_name, url, model, is_cerebras in candidates:
        key = vault.get_secret(key_name)
        if not key:
            continue
        result = _try_tool_call(url, key, model, messages, tools, max_tokens, is_cerebras)
        if result is not None:
            return result

    return {
        "content": (
            "I don't have a working AI key right now. "
            "Please add one in Settings → AI brain."
        ),
        "tool_calls": [],
        "raw": {},
    }


# ---------------------------------------------------------------------------
# Public: vision (Gemini multimodal)
# ---------------------------------------------------------------------------

def chat_vision(prompt, image_source, system=None, max_tokens=1024):
    """Analyse an image. Cascade: Gemini → Groq vision → error.

    image_source: file path (str/Path) or raw bytes.
    Returns {ok, reply, model} matching the chat() contract.
    """
    import base64
    import mimetypes
    from pathlib import Path as _P

    if isinstance(image_source, (str, _P)):
        path = _P(image_source)
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        data_bytes = path.read_bytes()
    else:
        mime = "image/jpeg"
        data_bytes = image_source
    b64 = base64.b64encode(data_bytes).decode()

    sys_ = system or DEFAULT_SYSTEM

    # --- 1. Gemini (best quality, free tier) ---
    gemini_key = vault.get_secret("gemini_key")
    if gemini_key:
        result = _gemini_vision(gemini_key, prompt, mime, b64, sys_, max_tokens)
        if result["ok"]:
            return result
        # 429 = quota exhausted → fall through to Groq
        if "429" not in str(result.get("error", "")) and "quota" not in str(result.get("error", "")).lower():
            return result   # hard error (bad key, malformed request) — don't cascade

    # --- 2. Groq vision (Llama 3.2 90B Vision, free) ---
    groq_key = vault.get_secret("groq_key")
    if groq_key:
        result = _groq_vision(groq_key, prompt, mime, b64, sys_, max_tokens)
        if result["ok"]:
            return result

    # --- 3. Claude vision (if anthropic key set) ---
    claude_key = vault.get_secret("anthropic_key")
    if claude_key:
        result = _claude_vision(claude_key, prompt, mime, b64, sys_, max_tokens)
        if result["ok"]:
            return result

    return {
        "ok": False,
        "reply": "I can't look at images right now — try again in a bit.",
        "error": "unavailable",
    }


def _gemini_vision(key, prompt, mime, b64, sys_, max_tokens):
    model = "gemini-2.0-flash"
    body  = {
        "contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": mime, "data": b64}},
        ]}],
        "systemInstruction": {"parts": [{"text": sys_}]},
        "generationConfig":  {"maxOutputTokens": max_tokens},
    }
    try:
        r    = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
            headers={"content-type": "application/json"},
            json=body, timeout=120,
        )
        data = r.json()
        if r.status_code != 200:
            return {"ok": False, "reply": str(data.get("error", {}).get("message", "Gemini vision error.")),
                    "error": str(r.status_code) + " " + str(data)[:200]}
        text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
        return {"ok": True, "reply": text, "model": model}
    except Exception as exc:
        return {"ok": False, "reply": f"Gemini vision failed: {exc}", "error": str(exc)}


def _groq_vision(key, prompt, mime, b64, sys_, max_tokens):
    """Groq Llama-3.2 vision (OpenAI-compatible image_url format)."""
    model = "meta-llama/llama-4-scout-17b-16e-instruct"
    data_url = f"data:{mime};base64,{b64}"
    msgs = [
        {"role": "system", "content": sys_},
        {"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]},
    ]
    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            json={"model": model, "max_tokens": max_tokens, "messages": msgs},
            timeout=120,
        )
        data = r.json()
        if r.status_code != 200:
            return {"ok": False, "reply": data.get("error", {}).get("message", "Groq vision error."),
                    "error": str(data)[:300]}
        return {"ok": True, "reply": data["choices"][0]["message"]["content"], "model": model}
    except Exception as exc:
        return {"ok": False, "reply": f"Groq vision failed: {exc}", "error": str(exc)}


def _claude_vision(key, prompt, mime, b64, sys_, max_tokens):
    """Anthropic Claude vision."""
    model = "claude-opus-4-8"
    msgs = [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
        {"type": "text", "text": prompt},
    ]}]
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": max_tokens, "system": sys_, "messages": msgs},
            timeout=120,
        )
        data = r.json()
        if r.status_code != 200:
            return {"ok": False, "reply": data.get("error", {}).get("message", "Claude vision error."),
                    "error": str(data)[:300]}
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        return {"ok": True, "reply": text, "model": model}
    except Exception as exc:
        return {"ok": False, "reply": f"Claude vision failed: {exc}", "error": str(exc)}


# ---------------------------------------------------------------------------
# Public: embeddings (Gemini text-embedding-004, free tier)
# ---------------------------------------------------------------------------

def embed(text: str) -> list:
    """Return a float vector (768 dims) or [] on failure."""
    key = vault.get_secret("gemini_key")
    if not key:
        return []
    try:
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={key}",
            headers={"content-type": "application/json"},
            json={"model": "models/text-embedding-004", "content": {"parts": [{"text": text}]}},
            timeout=30,
        )
        return r.json().get("embedding", {}).get("values", [])
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Internal: OpenAI-compatible tool-call attempt (single provider)
# ---------------------------------------------------------------------------

def _try_tool_call(url, key, model, messages, tools, max_tokens, is_cerebras):
    import json as _json
    body = {
        "model":       model,
        "messages":    messages,
        "tools":       tools,
        "tool_choice": "auto",
        ("max_completion_tokens" if is_cerebras else "max_tokens"): max_tokens,
    }
    for attempt in range(3):
        try:
            r = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
                json=body,
                timeout=120,
            )
        except Exception:
            return None  # network error → try next provider
        if r.status_code == 200:
            msg   = r.json()["choices"][0]["message"]
            calls = []
            for t in (msg.get("tool_calls") or []):
                try:
                    args = _json.loads(t["function"].get("arguments") or "{}")
                except Exception:
                    args = {}
                calls.append({"id": t.get("id"), "name": t["function"]["name"], "args": args})
            return {"content": msg.get("content") or "", "tool_calls": calls, "raw": msg}
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(1.5 ** attempt)   # 1s, 1.5s
            continue
        break   # 4xx (bad key/model) → don't retry, skip to next provider
    return None


# ---------------------------------------------------------------------------
# Internal: Cerebras fallback (key-2 then Groq)
# ---------------------------------------------------------------------------

def _cerebras_fallback(model, sys_, msgs, fmt, max_tokens):
    key2 = vault.get_secret("cerebras_key_2")
    if key2:
        r = _cerebras(model, sys_, msgs, key2, fmt, max_tokens)
        if r["ok"]:
            return r
    gk = vault.get_secret("groq_key")
    if gk:
        return _groq(DEFAULT_MODEL["groq"], sys_, msgs, gk, fmt, max_tokens)
    return {
        "ok": False,
        "reply": "I'm a bit overloaded right now — try again in a moment.",
        "error": "all_providers_down",
    }


# ---------------------------------------------------------------------------
# Internal: provider implementations
# ---------------------------------------------------------------------------

def _cerebras(model, sys_, msgs, key, fmt, max_tokens):
    m    = [{"role": "system", "content": sys_ + ("\nRespond with JSON." if fmt == "json" else "")}] + msgs
    body = {"model": model, "max_completion_tokens": max_tokens, "messages": m}
    if fmt == "json":
        body["response_format"] = {"type": "json_object"}
    last = None
    for attempt in range(3):
        r = httpx.post(
            "https://api.cerebras.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            json=body,
            timeout=120,
        )
        if r.status_code == 200:
            return {"ok": True, "reply": r.json()["choices"][0]["message"]["content"], "model": model}
        last = r
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(1.5 ** attempt)
            continue
        break
    data = {}
    try:
        data = last.json() if last is not None else {}
    except Exception:
        pass
    msg = data.get("error", {}).get("message") or f"error {getattr(last, 'status_code', '?')}"
    return {"ok": False, "reply": msg, "error": str(data)[:300]}


def _groq(model, sys_, msgs, key, fmt, max_tokens):
    m    = [{"role": "system", "content": sys_ + ("\nRespond with JSON." if fmt == "json" else "")}] + msgs
    body = {"model": model, "max_tokens": max_tokens, "messages": m}
    if fmt == "json":
        body["response_format"] = {"type": "json_object"}
    r = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        json=body,
        timeout=120,
    )
    data = r.json()
    if r.status_code != 200:
        return {
            "ok": False,
            "reply": data.get("error", {}).get("message", "Groq API error."),
            "error": str(data)[:300],
        }
    return {"ok": True, "reply": data["choices"][0]["message"]["content"], "model": model}


def _claude(model, sys_, msgs, key, fmt, max_tokens):
    if fmt == "json":
        sys_ = sys_ + "\nRespond with valid JSON only — no prose, no code fences."
    body = {"model": model, "max_tokens": max_tokens, "system": sys_, "messages": msgs}
    r    = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json=body,
        timeout=120,
    )
    data = r.json()
    if r.status_code != 200:
        return {
            "ok": False,
            "reply": data.get("error", {}).get("message", "Claude API error."),
            "error": str(data)[:300],
        }
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return {"ok": True, "reply": text, "model": model}


def _openai(model, sys_, msgs, key, fmt, max_tokens):
    m    = [{"role": "system", "content": sys_ + ("\nRespond with JSON." if fmt == "json" else "")}] + msgs
    body = {"model": model, "max_tokens": max_tokens, "messages": m}
    if fmt == "json":
        body["response_format"] = {"type": "json_object"}
    r    = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        json=body,
        timeout=120,
    )
    data = r.json()
    if r.status_code != 200:
        return {
            "ok": False,
            "reply": data.get("error", {}).get("message", "OpenAI API error."),
            "error": str(data)[:300],
        }
    return {"ok": True, "reply": data["choices"][0]["message"]["content"], "model": model}


def _gemini(model, sys_, msgs, key, fmt, max_tokens):
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user",
         "parts": [{"text": m["content"]}]}
        for m in msgs
    ]
    gen  = {"maxOutputTokens": max_tokens}
    if fmt == "json":
        gen["responseMimeType"] = "application/json"
    body = {
        "contents":           contents,
        "systemInstruction":  {"parts": [{"text": sys_}]},
        "generationConfig":   gen,
    }
    r    = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        headers={"content-type": "application/json"},
        json=body,
        timeout=120,
    )
    data = r.json()
    if r.status_code != 200:
        return {
            "ok": False,
            "reply": str(data.get("error", {}).get("message", "Gemini API error.")),
            "error": str(data)[:300],
        }
    try:
        text = "".join(
            part.get("text", "")
            for part in data["candidates"][0]["content"]["parts"]
        )
    except Exception:
        text = ""
    return {"ok": True, "reply": text, "model": model}
