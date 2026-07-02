"""Voice service: TTS synthesis, STT transcription, and voice settings."""

import asyncio
import io
import os
import tempfile

from ..kernel import config
from . import clone_engine, piper_engine

DEFAULT_VOICE = "en-US-AriaNeural"
DEFAULT_RATE = "+0%"
DEFAULT_STT = "tiny.en"

_whisper = None


def get_config():
    stored_engine = config.get("voice_engine", "")
    stored_voice  = config.get("voice_name", "")
    # Smart defaults: prefer piper when available (offline, instant), else edge.
    if not stored_engine:
        stored_engine = "piper" if piper_engine.available() else "edge"
    if not stored_voice:
        stored_voice = "en_US-libritts-high:0" if stored_engine == "piper" else DEFAULT_VOICE
    return {
        "engine": stored_engine,
        "voice": stored_voice,
        "rate": config.get("voice_rate", DEFAULT_RATE),
        "stt_model": config.get("voice_stt", DEFAULT_STT),
    }


def set_config(engine=None, voice=None, rate=None, stt_model=None):
    if engine:
        config.set("voice_engine", engine)
    if voice:
        config.set("voice_name", voice)
    if rate is not None:
        config.set("voice_rate", rate)
    if stt_model:
        config.set("voice_stt", stt_model)
    return get_config()


# --- TTS -------------------------------------------------------------------------
async def _edge(text, voice, rate):
    import edge_tts
    com = edge_tts.Communicate(text, voice or DEFAULT_VOICE, rate=rate or DEFAULT_RATE)
    buf = io.BytesIO()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


def tts(text, engine=None, voice=None, rate=None):
    cfg = get_config()
    engine = engine or cfg["engine"]
    voice = voice or cfg["voice"]
    rate = rate or cfg["rate"]
    text = (text or "").strip()
    if not text:
        return b"", "audio/mpeg"
    if engine == "piper" and piper_engine.available():
        return piper_engine.synth(text, voice), "audio/wav"
    if engine == "clone" and clone_engine.available():
        return clone_engine.synth(text), "audio/wav"
    # edge is the natural default (and the fallback if a local engine isn't ready)
    return asyncio.run(_edge(text, voice, rate)), "audio/mpeg"


def list_voices(engine="edge"):
    if engine == "piper":
        return piper_engine.voices()
    if engine == "clone":
        return clone_engine.voices()
    import edge_tts
    voices = asyncio.run(edge_tts.list_voices())
    out = []
    for v in voices:
        if v["ShortName"].startswith("en-"):
            out.append({"id": v["ShortName"], "gender": v.get("Gender", ""),
                        "locale": v.get("Locale", ""),
                        "name": v["ShortName"].replace("Neural", "").replace("en-", "")})
    return out


# --- STT -------------------------------------------------------------------------
def _hosted_stt(audio_bytes, suffix):
    """Cloud transcription via a hosted Whisper API (no heavy local model).

    Used when faster-whisper isn't installed (e.g. the cloud build). Picks whichever key
    is set: Groq (free, fast) first, then OpenAI. Returns "" if none configured.
    """
    from ..kernel import vault
    import httpx
    fname = "clip" + (suffix if suffix.startswith(".") else "." + suffix)
    providers = [
        ("groq_key", "https://api.groq.com/openai/v1/audio/transcriptions", "whisper-large-v3"),
        ("openai_key", "https://api.openai.com/v1/audio/transcriptions", "whisper-1"),
    ]
    for key_name, url, model in providers:
        key = vault.get_secret(key_name)
        if not key:
            continue
        try:
            r = httpx.post(url, headers={"Authorization": f"Bearer {key}"},
                           files={"file": (fname, audio_bytes)},
                           data={"model": model, "language": "en", "response_format": "json"},
                           timeout=60)
            if r.status_code < 300:
                return (r.json().get("text") or "").strip()
        except Exception:
            pass
    return ""


def stt(audio_bytes, suffix=".webm"):
    global _whisper
    if not audio_bytes:
        return ""
    try:
        from faster_whisper import WhisperModel
    except Exception:
        # No local model (cloud build) → use a hosted Whisper API instead.
        return _hosted_stt(audio_bytes, suffix)
    if _whisper is None:
        _whisper = WhisperModel(get_config()["stt_model"], device="cpu", compute_type="int8")
    if not suffix.startswith("."):
        suffix = "." + suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        path = f.name
    try:
        segments, _info = _whisper.transcribe(path, language="en", vad_filter=True)
        text = " ".join(s.text for s in segments).strip()
        if not text:
            # VAD filter can drop short/quiet clips — retry without it before giving up.
            segments, _info = _whisper.transcribe(path, language="en", vad_filter=False)
            text = " ".join(s.text for s in segments).strip()
        return text
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def engines():
    """Which engines are usable right now (for the Settings UI)."""
    return {
        "edge":  {"label": "Edge Neural (natural, online)", "ready": True},
        "piper": {"label": "Piper (offline)", "ready": piper_engine.available()},
        "clone": {"label": "Cloned voice (local CPU, ~12s/sentence)",
                  "ready": clone_engine.available()},
    }
