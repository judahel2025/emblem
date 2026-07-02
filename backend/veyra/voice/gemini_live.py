"""Kora's realtime voice bridge (official google-genai SDK).

The browser opens a WebSocket to /api/voice/live and streams mic audio (16-bit PCM,
16 kHz). We relay it into a Gemini Live session, stream the model's audio (24 kHz PCM)
back, and surface both sides' words as caption frames.

Two modes (?mode=):
  * chat        — the everyday voice conversation (default).
  * onboarding  — Kora MEETS a new user: she speaks first, interviews them naturally
                  (name → what they do → what to help with → tone), then calls the
                  save_profile function; we write their profile + memory rows and tell
                  the client it's done.

Identity: WebSockets bypass the HTTP auth middleware, so the client passes its Supabase
access token as ?token=…; we resolve it with the same auth layer and bind the user to
this session's context so profile/memory writes land on the right person.

Provider secrecy: the client only ever sees generic frames ({"type":"audio"|"caption"|
"status"}). It never learns what powers this. The key lives in the vault / env only.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

from ..kernel import context, vault

log = logging.getLogger("veyra.voice.live")

_MODEL = os.environ.get("GEMINI_LIVE_MODEL", "models/gemini-2.0-flash-live-001")
_VOICE = os.environ.get("GEMINI_LIVE_VOICE", "Zephyr")

_PERSONA_CHAT = (
    "You are Kora — the user's warm, concise, decisive voice assistant. Keep replies "
    "short and spoken-natural. Never reveal which AI, model, or provider powers you."
)

_PERSONA_ONBOARDING = (
    "You are Kora, and you are meeting a brand-new member for the very first time. "
    "You speak FIRST: greet them briefly and warmly, introduce yourself in one sentence "
    "('I'm Kora — I'll be working alongside you'), and begin. Have a natural, human "
    "conversation — ONE question at a time, brief and warm, reacting to what they say. "
    "You need to learn, in this order: (1) their name, (2) what they do, (3) the first "
    "thing they'd love help with, (4) how they like to be spoken to — casual or formal, "
    "brief or detailed. Weave the questions into conversation; never read them like a "
    "form. When you have all four, thank them by name, tell them you'll remember, and "
    "CALL the save_profile function with what you learned. Keep every turn under three "
    "sentences. Never reveal which AI, model, or provider powers you."
)

_SAVE_PROFILE_TOOL = {
    "function_declarations": [{
        "name": "save_profile",
        "description": "Save what you learned about the new member. Call once, at the end.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "display_name": {"type": "STRING", "description": "What they want to be called"},
                "role": {"type": "STRING", "description": "What they do / their work"},
                "focus": {"type": "STRING", "description": "The first thing they want help with"},
                "tone": {"type": "STRING", "description": "How they like to be spoken to"},
            },
            "required": ["display_name"],
        },
    }]
}


def _key():
    return (vault.get_secret("gemini_key") or vault.get_secret("google_key")
            or os.environ.get("GEMINI_KEY") or os.environ.get("GEMINI_API_KEY"))


def _config(mode: str):
    cfg = {
        "response_modalities": ["AUDIO"],
        "system_instruction": _PERSONA_ONBOARDING if mode == "onboarding" else _PERSONA_CHAT,
        "speech_config": {
            "voice_config": {"prebuilt_voice_config": {"voice_name": _VOICE}}
        },
        # Both sides transcribed → live captions in the UI.
        "input_audio_transcription": {},
        "output_audio_transcription": {},
    }
    if mode == "onboarding":
        cfg["tools"] = [_SAVE_PROFILE_TOOL]
    return cfg


def _save_profile(uid: str | None, args: dict):
    """Persist the onboarding result: profile row + durable memory, as this user."""
    from ..kernel import data as db
    from ..memory import store as memstore

    name = (args.get("display_name") or "").strip()
    role = (args.get("role") or "").strip()
    focus = (args.get("focus") or "").strip()
    tone = (args.get("tone") or "").strip()

    if uid:
        try:
            existing = db.one("SELECT user_id FROM profiles WHERE user_id = ?", (uid,))
            fields = {"display_name": name, "role": role, "tone": tone, "onboarded": True}
            if existing:
                sets = ", ".join(f"{k} = ?" for k in fields) + ", updated_at = datetime('now')"
                db.write(f"UPDATE profiles SET {sets} WHERE user_id = ?", (*fields.values(), uid))
            else:
                cols = ", ".join(["user_id", *fields])
                marks = ", ".join(["?"] * (len(fields) + 1))
                db.write(f"INSERT INTO profiles ({cols}) VALUES ({marks})", (uid, *fields.values()))
        except Exception as exc:
            log.warning("onboarding profile write failed: %s", exc)

    try:
        if name:
            memstore.remember(f"The user's name is {name}.", "identity", "onboarding")
        if role:
            memstore.remember(f"What the user does: {role}.", "identity", "onboarding")
        if focus:
            memstore.remember(f"Something the user wants help with: {focus}.", "preference", "onboarding")
        if tone:
            memstore.remember(f"How the user likes to be spoken to: {tone}.", "preference", "onboarding")
    except Exception as exc:
        log.warning("onboarding memory write failed: %s", exc)


async def bridge(client_ws):
    """Run the browser<->Live relay for one session. `client_ws` is a FastAPI WebSocket."""
    await client_ws.accept()

    mode = (client_ws.query_params.get("mode") or "chat").lower()
    token = client_ws.query_params.get("token") or ""

    # Bind the caller's identity for this session (WS skips the HTTP middleware).
    uid = None
    try:
        from ..api import auth as _auth
        identity = _auth.resolve_identity(f"Bearer {token}" if token else "")
        if identity:
            uid = identity[0]
    except Exception:
        pass
    tokens = context.set_user(uid, "user")

    key = _key()
    if not key:
        await client_ws.send_json({"type": "status", "state": "unavailable"})
        await client_ws.close()
        context.reset(tokens)
        return

    try:
        from google import genai
    except Exception:
        log.warning("google-genai not installed — live voice disabled")
        await client_ws.send_json({"type": "status", "state": "unavailable"})
        await client_ws.close()
        context.reset(tokens)
        return

    client = genai.Client(api_key=key, http_options={"api_version": "v1beta"})

    try:
        async with client.aio.live.connect(model=_MODEL, config=_config(mode)) as session:
            await client_ws.send_json({"type": "status", "state": "ready"})

            if mode == "onboarding":
                # Kora speaks first — nudge the model to open the conversation.
                await session.send_client_content(
                    turns={"role": "user", "parts": [{"text":
                        "(The new member just arrived. Greet them and begin.)"}]},
                    turn_complete=True)

            async def pump_client_to_session():
                """Mic PCM + control/text frames from the browser → the session."""
                while True:
                    msg = await client_ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    data = msg.get("bytes")
                    text = msg.get("text")
                    if data:
                        try:
                            await session.send_realtime_input(
                                audio={"data": data, "mime_type": "audio/pcm;rate=16000"})
                        except Exception:
                            await session.send(input={"data": data, "mime_type": "audio/pcm"})
                    elif text:
                        try:
                            payload = json.loads(text)
                        except Exception:
                            continue
                        if payload.get("type") == "end":
                            break
                        if payload.get("type") == "text" and payload.get("text"):
                            await session.send_client_content(
                                turns={"role": "user", "parts": [{"text": payload["text"]}]},
                                turn_complete=True)

            async def pump_session_to_client():
                """Model audio / captions / tool calls → the browser as generic frames."""
                while True:
                    turn = session.receive()
                    async for response in turn:
                        # tool call: Kora finished the interview → save + finish
                        tc = getattr(response, "tool_call", None)
                        if tc and getattr(tc, "function_calls", None):
                            for fc in tc.function_calls:
                                if fc.name == "save_profile":
                                    _save_profile(uid, dict(fc.args or {}))
                                    try:
                                        await session.send_tool_response(function_responses=[{
                                            "id": fc.id, "name": fc.name,
                                            "response": {"ok": True}}])
                                    except Exception:
                                        pass
                                    await client_ws.send_json(
                                        {"type": "status", "state": "onboarded"})
                            continue

                        sc = getattr(response, "server_content", None)
                        if sc is not None:
                            it = getattr(sc, "input_transcription", None)
                            if it and getattr(it, "text", None):
                                await client_ws.send_json(
                                    {"type": "caption", "who": "user", "text": it.text})
                            ot = getattr(sc, "output_transcription", None)
                            if ot and getattr(ot, "text", None):
                                await client_ws.send_json(
                                    {"type": "caption", "who": "assistant", "text": ot.text})
                            if getattr(sc, "interrupted", None):
                                await client_ws.send_json(
                                    {"type": "status", "state": "interrupted"})

                        if getattr(response, "data", None):
                            await client_ws.send_json({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode(),
                            })
                        elif getattr(response, "text", None):
                            await client_ws.send_json({"type": "caption", "who": "assistant",
                                                       "text": response.text})
                    await client_ws.send_json({"type": "status", "state": "turn_complete"})

            await asyncio.gather(pump_client_to_session(), pump_session_to_client())
    except Exception as exc:
        log.warning("live voice bridge ended: %s", exc)
        try:
            await client_ws.send_json({"type": "status", "state": "ended"})
        except Exception:
            pass
    finally:
        context.reset(tokens)
        try:
            await client_ws.close()
        except Exception:
            pass
