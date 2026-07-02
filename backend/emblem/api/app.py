"""Emblem kernel-backed API (FastAPI).

Every tool call goes through the kernel, so the UI gets real approvals, audit, kill
switch, and reversible file ops. Ollama endpoints bridge the local model (active once a
model is installed). CORS is locked to localhost; the frontend is served same-origin.
"""

import asyncio
import json
import logging

from fastapi import FastAPI, File, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import kernel
from ..kernel import (ApprovalRejected, ApprovalRequired, KernelError, REGISTRY,
                      approvals, audit, config, paths, snapshots, vault)
from ..tools import load_all

_log = logging.getLogger("emblem.app")

app = FastAPI(title="Emblem Core", version="0.2.0")


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"(http://(127\.0\.0\.1|localhost)(:\d+)?)|(https?://tauri\.localhost)|(tauri://localhost)|(https://([a-z0-9\-]+\.)?emblem(-[a-z0-9\-]+)?\.pages\.dev)",
    allow_methods=["*"],
    allow_headers=["*"],
)


import os as _os_auth
from fastapi.responses import JSONResponse as _JSONResponse

from . import auth as _auth
from ..kernel import context as _ctx

_API_TOKEN = _os_auth.environ.get("EMBLEM_API_TOKEN")


@app.middleware("http")
async def _auth_gate(request, call_next):
    """Multi-user gate: resolve the caller's identity from the Supabase JWT (or the
    service token) and bind it to the request context so the data layer scopes rows
    per user. Public paths (/api/health) skip auth. On the local
    PC build (no cloud auth configured) everything stays open as the local owner."""
    if request.method == "OPTIONS" or _auth.is_public(request.url.path):
        return await call_next(request)

    identity = _auth.resolve_identity(request.headers.get("authorization", ""))
    if identity is None:
        return _JSONResponse({"error": "unauthorized"}, status_code=401)

    user_id, actor = identity
    tokens = _ctx.set_user(user_id, actor)
    try:
        return await call_next(request)
    finally:
        _ctx.reset(tokens)


@app.middleware("http")
async def _no_cache_html(request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith(".html"):
        resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.on_event("startup")
async def _startup():
    kernel.boot()
    load_all()
    from .. import scheduler
    scheduler.start()
    from ..voice import clone_engine
    clone_engine.pre_warm()


# --- models ----------------------------------------------------------------------
class ToolCall(BaseModel):
    name: str
    args: dict = {}
    approval_id: int | None = None


class Decision(BaseModel):
    approved: bool
    note: str = ""


class Secret(BaseModel):
    name: str
    value: str


class Flag(BaseModel):
    on: bool


class ChatIn(BaseModel):
    prompt: str
    model: str = "llama3.2:3b"
    mode: str = "general"


def _owner_404():
    """The response non-admins get on owner-only surfaces: a plain 404, so the route's
    very existence (and anything about providers/internals) stays invisible."""
    return _JSONResponse({"error": "not found"}, status_code=404)


# --- identity ---------------------------------------------------------------------
@app.get("/api/me")
def me():
    """Who am I? The one route the frontend uses to decide which UI to render."""
    uid = _ctx.user_id()
    is_admin = _ctx.is_owner()
    display_name, onboarded = "", False
    try:
        from ..kernel import data as _db
        row = _db.one("SELECT display_name, onboarded FROM profiles WHERE user_id = ?", (uid,))
        if row:
            display_name = row.get("display_name") or ""
            onboarded = bool(row.get("onboarded"))
    except Exception:
        pass
    return {"user_id": uid, "is_admin": is_admin,
            "display_name": display_name, "onboarded": onboarded}


class ProfileIn(BaseModel):
    display_name: str | None = None
    role: str | None = None
    tone: str | None = None
    onboarded: bool | None = None
    quiet_start: str | None = None
    quiet_end: str | None = None


@app.get("/api/profile")
def profile_get():
    from ..kernel import data as _db
    uid = _ctx.user_id()
    row = None
    try:
        row = _db.one("SELECT display_name, role, tone, onboarded, quiet_start, quiet_end "
                      "FROM profiles WHERE user_id = ?", (uid,))
    except Exception:
        pass
    return row or {"display_name": "", "role": "", "tone": "", "onboarded": False,
                   "quiet_start": "22:00", "quiet_end": "07:00"}


@app.post("/api/profile")
def profile_set(body: ProfileIn):
    from ..kernel import data as _db
    uid = _ctx.user_id()
    if not uid:
        return {"ok": False}
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        return {"ok": True}
    try:
        existing = _db.one("SELECT user_id FROM profiles WHERE user_id = ?", (uid,))
        if existing:
            sets = ", ".join(f"{k} = ?" for k in fields) + ", updated_at = datetime('now')"
            _db.write(f"UPDATE profiles SET {sets} WHERE user_id = ?", (*fields.values(), uid))
        else:
            cols = ", ".join(["user_id", *fields])
            marks = ", ".join(["?"] * (len(fields) + 1))
            _db.write(f"INSERT INTO profiles ({cols}) VALUES ({marks})", (uid, *fields.values()))
        return {"ok": True}
    except Exception as exc:
        _log.warning("profile_set failed: %s", exc)
        return {"ok": False}


# --- health & meta ---------------------------------------------------------------
@app.get("/api/health")
def health():
    # Public + unauthenticated: reveal NOTHING about which AI/model/provider powers Emblem.
    # Only a generic liveness + a boolean "ready" so the client can gate the UI.
    from ..agent import brain
    try:
        ready = bool(brain.status().get("ready"))
    except Exception:
        ready = False
    return {"name": "Emblem", "status": "online", "ready": ready}


@app.get("/api/kernel/status")
def kernel_status():
    if not _ctx.is_owner():
        return _owner_404()
    return kernel.status()


@app.get("/api/tools")
def tools():
    # The tool manifest names every connector — owner-only.
    if not _ctx.is_owner():
        return _owner_404()
    return {"tools": REGISTRY.manifest()}


# Tool-name prefixes regular users may execute directly (their own scoped surfaces).
_USER_TOOL_PREFIXES = ("notes.", "memory.", "pages.", "calendar.", "automation.",
                       "composio.", "code.", "schedule.")


# --- the choke point: run a tool through the kernel ------------------------------
@app.post("/api/tools/execute")
def execute(call: ToolCall):
    if not _ctx.is_owner() and not call.name.startswith(_USER_TOOL_PREFIXES):
        return _owner_404()
    try:
        result = kernel.execute_tool(call.name, call.args, actor="user",
                                     approval_id=call.approval_id)
        return {"ok": True, "result": result}
    except ApprovalRequired as exc:
        return {"ok": False, "approval_required": True,
                "approval_id": exc.approval_id, "summary": exc.summary}
    except ApprovalRejected as exc:
        return {"ok": False, "rejected": True, "approval_id": exc.approval_id}
    except KernelError as exc:
        return {"ok": False, "error": str(exc)}


# --- approvals -------------------------------------------------------------------
@app.get("/api/approvals")
def list_approvals():
    return {"pending": approvals.pending(), "recent": approvals.recent()}


@app.get("/api/approvals/filter")
def approvals_filter(tool: str = "", status: str = "pending", limit: int = 100):
    """Filter approvals by tool prefix and status.
    GET /api/approvals/filter?tool=estoppel&status=pending
    GET /api/approvals/filter?status=all
    """
    return {"items": approvals.by_tool(tool, status, limit)}


@app.post("/api/approvals/{approval_id}/decide")
def decide(approval_id: int, body: Decision):
    # Approving here doesn't just flag it — it runs the bound action (button or voice "go ahead").
    res = kernel.resolve_approval(approval_id, body.approved, decided_by="user", note=body.note)
    return {"ok": res.get("ok", False), "approval_id": approval_id,
            "status": "approved" if body.approved else "rejected", "result": res.get("result")}


# --- audit & snapshots (owner-only: the audit names every tool/connector) ---------
@app.get("/api/audit")
def audit_tail(limit: int = 100):
    if not _ctx.is_owner():
        return _owner_404()
    return {"items": audit.tail(limit)}


@app.get("/api/snapshots")
def list_snapshots():
    if not _ctx.is_owner():
        return _owner_404()
    return {"items": snapshots.recent()}


@app.post("/api/snapshots/{snapshot_id}/restore")
def restore(snapshot_id: int):
    if not _ctx.is_owner():
        return _owner_404()
    return {"ok": snapshots.restore(snapshot_id)}


# --- secrets (names only ever leave the building) --------------------------------
@app.get("/api/secrets")
def secrets():
    # Secret NAMES (cerebras_key, composio_key, ...) reveal which providers are in use —
    # owner-only. Values never leave the vault regardless.
    if not _ctx.is_owner():
        return _JSONResponse({"error": "not permitted"}, status_code=403)
    return {"items": vault.list_secrets(), "dpapi": vault.dpapi_available()}


@app.post("/api/secrets")
def set_secret(body: Secret):
    if not _ctx.is_owner():
        return _JSONResponse({"error": "not permitted"}, status_code=403)
    vault.set_secret(body.name, body.value)
    return {"ok": True, "name": body.name}


@app.delete("/api/secrets/{name}")
def delete_secret(name: str):
    if not _ctx.is_owner():
        return _JSONResponse({"error": "not permitted"}, status_code=403)
    vault.delete_secret(name)
    return {"ok": True}


# --- config / safety flags -------------------------------------------------------
@app.get("/api/config")
def get_config():
    snap = config.snapshot()
    if _ctx.is_owner():
        return snap
    # Non-owners: only the flags they need to see — no tool-name lists that would
    # reveal which connectors/providers are wired.
    return {"kill_switch": snap.get("kill_switch"), "approval_mode": snap.get("approval_mode")}


@app.post("/api/config/kill-switch")
def kill_switch(body: Flag):
    if not _ctx.is_owner():
        return _owner_404()
    config.set_kill_switch(body.on)
    return {"ok": True, "kill_switch": body.on}


@app.post("/api/config/local-only")
def local_only(body: Flag):
    if not _ctx.is_owner():
        return _owner_404()
    config.set_local_only(body.on)
    return {"ok": True, "local_only": body.on}


class ApprovalMode(BaseModel):
    mode: str = "ask"


@app.post("/api/config/approval-mode")
def approval_mode(body: ApprovalMode):
    if not _ctx.is_owner():
        return _owner_404()
    config.set_approval_mode(body.mode)
    return {"ok": True, "approval_mode": config.approval_mode()}


class TrustIn(BaseModel):
    tool: str
    on: bool = True


@app.post("/api/config/trust")
def set_trust(body: TrustIn):
    if not _ctx.is_owner():
        return _owner_404()
    config.set_auto_approved(body.tool, body.on)
    return {"ok": True, "tool": body.tool, "trusted": body.on}


@app.post("/api/emails/{eid}/send")
def send_email_draft(eid: int):
    """Human-initiated send: the owner reviewed the draft and clicked Send."""
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import emails
    from ..connectors import resend_mail
    row = emails.get_one(eid)
    if not row:
        return {"ok": False, "error": "draft not found"}
    if not (row.get("recipient") or "").strip():
        return {"ok": False, "error": "this draft has no recipient address"}
    res = resend_mail.send_to(row["recipient"], subject=row.get("subject", ""), body=row.get("body", ""), purpose="default")
    if res.get("ok"):
        emails.mark_sent(eid)
    return res


# --- master-password lock (single user = the owner; opt-in) --------------------
import hashlib as _hashlib
import hmac as _hmac
import os as _os


class LockIn(BaseModel):
    password: str = ""
    current: str = ""


def _hash_pw(pw: str, salt: bytes) -> str:
    return _hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000).hex()


@app.get("/api/lock")
def lock_status():
    if not _ctx.is_owner():
        return _owner_404()
    return {"enabled": bool(vault.get_secret("master_pw_hash"))}


@app.post("/api/lock/set")
def lock_set(body: LockIn):
    if not _ctx.is_owner():
        return _owner_404()
    existing = vault.get_secret("master_pw_hash")
    if existing:  # changing an existing password requires the current one
        salt = bytes.fromhex(vault.get_secret("master_pw_salt") or "")
        if not body.current or not _hmac.compare_digest(_hash_pw(body.current, salt), existing):
            return {"ok": False, "error": "current password is incorrect"}
    if len(body.password or "") < 4:
        return {"ok": False, "error": "password must be at least 4 characters"}
    salt = _os.urandom(16)
    vault.set_secret("master_pw_salt", salt.hex())
    vault.set_secret("master_pw_hash", _hash_pw(body.password, salt))
    return {"ok": True}


@app.post("/api/lock/verify")
def lock_verify(body: LockIn):
    if not _ctx.is_owner():
        return _owner_404()
    existing = vault.get_secret("master_pw_hash")
    if not existing:
        return {"ok": True}  # no lock set → always open
    salt = bytes.fromhex(vault.get_secret("master_pw_salt") or "")
    return {"ok": _hmac.compare_digest(_hash_pw(body.password, salt), existing)}


@app.post("/api/lock/disable")
def lock_disable(body: LockIn):
    if not _ctx.is_owner():
        return _owner_404()
    existing = vault.get_secret("master_pw_hash")
    if existing:
        salt = bytes.fromhex(vault.get_secret("master_pw_salt") or "")
        if not _hmac.compare_digest(_hash_pw(body.password or body.current, salt), existing):
            return {"ok": False, "error": "password is incorrect"}
    vault.delete_secret("master_pw_hash")
    vault.delete_secret("master_pw_salt")
    return {"ok": True}


# --- direct brain chat (used by the IDE side-panel; owner-only) -------------------
@app.get("/api/models")
def models():
    if not _ctx.is_owner():
        return _owner_404()
    # Never expose provider/model identity to the client.
    return {"ok": True, "models": []}


@app.post("/api/chat")
def chat(body: ChatIn):
    if not _ctx.is_owner():
        return _owner_404()
    from ..agent import brain
    sys = ("You are Emblem, the owner's coding copilot. Give correct, complete, working code "
           "and brief, clear guidance.") if body.mode == "coding" else None
    return brain.chat(body.prompt, system=sys)


# --- voice service (natural TTS + STT, pluggable engines) ------------------------
class VoiceCfg(BaseModel):
    engine: str | None = None
    voice: str | None = None
    rate: str | None = None
    stt_model: str | None = None


class TTSIn(BaseModel):
    text: str
    engine: str | None = None
    voice: str | None = None
    rate: str | None = None


@app.get("/api/voice/config")
def voice_config():
    from ..voice import service
    if not _ctx.is_owner():
        # Users get only the current voice basics — no engine list (reveals providers).
        cfg = service.get_config()
        return {"voice": cfg.get("voice"), "rate": cfg.get("rate")}
    return {**service.get_config(), "engines": service.engines()}


@app.post("/api/voice/config")
def voice_config_set(b: VoiceCfg):
    if not _ctx.is_owner():
        return _owner_404()
    from ..voice import service
    return service.set_config(b.engine, b.voice, b.rate, b.stt_model)


@app.get("/api/voice/voices")
def voice_voices(engine: str = "edge"):
    from ..voice import service
    return {"voices": service.list_voices(engine)}


@app.post("/api/voice/tts")
def voice_tts(b: TTSIn):
    from ..voice import service
    audio, mime = service.tts(b.text, b.engine, b.voice, b.rate)
    return Response(content=audio, media_type=mime)


@app.post("/api/voice/stt")
async def voice_stt(audio: UploadFile = File(...)):
    from ..voice import service
    data = await audio.read()
    name = audio.filename or "clip.webm"
    suffix = name.rsplit(".", 1)[-1] if "." in name else "webm"
    return {"text": service.stt(data, "." + suffix)}


# --- agent (intent routing: write code -> editor, run -> terminal, etc.) ---------
class AgentIn(BaseModel):
    command: str
    context: dict = {}


@app.post("/api/agent")
def agent(body: AgentIn):
    from ..agent.loop import run
    try:
        return run(body.command, body.context)
    except Exception as exc:
        _log.warning("agent run failed: %s", exc)  # detail to server logs only
        return {"intent": "error", "reply": "Something went wrong on my end — try that again.", "actions": []}


# --- the brain: which LLM provider/model powers Emblem ----------------------------
class BrainCfg(BaseModel):
    provider: str | None = None
    model: str | None = None


@app.get("/api/brain")
def brain_get():
    from ..agent import brain
    # Non-owners get ONLY a readiness boolean — no provider, model, or label.
    if not _ctx.is_owner():
        try:
            return {"ready": bool(brain.status().get("ready"))}
        except Exception:
            return {"ready": False}
    cfg = brain.get_config()
    cfg["status"] = brain.status()
    return cfg


@app.post("/api/brain")
def brain_set(b: BrainCfg):
    from ..agent import brain
    if not _ctx.is_owner():
        return _JSONResponse({"error": "not permitted"}, status_code=403)
    return brain.set_config(b.provider, b.model)


# --- notes (local, Google-Keep style) --------------------------------------------
class NoteIn(BaseModel):
    title: str = ""
    body: str = ""
    color: str = "default"


class NotePatch(BaseModel):
    title: str | None = None
    body: str | None = None
    color: str | None = None
    pinned: int | None = None


@app.get("/api/notes")
def notes_list():
    from ..tools import notes
    return {"items": notes.listing()}


@app.post("/api/notes")
def notes_add(body: NoteIn):
    from ..tools import notes
    return notes.add(body.title, body.body, body.color)


@app.put("/api/notes/{note_id}")
def notes_update(note_id: int, body: NotePatch):
    from ..tools import notes
    return notes.update(note_id, **{k: v for k, v in body.model_dump().items() if v is not None})


@app.delete("/api/notes/{note_id}")
def notes_delete(note_id: int):
    from ..tools import notes
    return notes.delete(note_id)


# --- persistent memory (long-term recall) ----------------------------------------
class MemIn(BaseModel):
    content: str
    kind: str = "fact"


class MemUpdate(BaseModel):
    content: str
    kind: str = "fact"


@app.get("/api/memory")
def memory_list(limit: int = 200):
    from ..memory import store
    return {"items": store.listing(limit)}


@app.post("/api/memory")
def memory_add(body: MemIn):
    from ..memory import store
    return store.remember(body.content, body.kind, source="user")


@app.put("/api/memory/{mid}")
def memory_update(mid: int, body: MemUpdate):
    from ..memory import store
    return store.remember(body.content, body.kind, source="user", memory_id=mid)


@app.delete("/api/memory/{mid}")
def memory_delete(mid: int):
    from ..memory import store
    return store.delete(mid)


@app.get("/api/memory/{mid}/versions")
def memory_versions(mid: int):
    from ..memory import store
    return {"items": store.versions(mid)}


@app.post("/api/memory/{mid}/rollback/{version_id}")
def memory_rollback(mid: int, version_id: int):
    from ..memory import store
    return store.rollback(mid, version_id)


# Resend drafts/outbox — the operator's mail surface, owner-only.
@app.get("/api/emails")
def emails_list(status: str = ""):
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import emails
    return {"items": emails.listing(status or None)}


@app.post("/api/emails/{eid}/archive")
def email_archive(eid: int):
    if not _ctx.is_owner():
        return _owner_404()
    return kernel.execute_tool("email.archive", {"id": eid}, actor="user")


@app.post("/api/emails/{eid}/restore")
def email_restore(eid: int):
    if not _ctx.is_owner():
        return _owner_404()
    return kernel.execute_tool("email.restore", {"id": eid}, actor="user")


@app.delete("/api/emails/{eid}")
def email_delete(eid: int):
    if not _ctx.is_owner():
        return _owner_404()
    return kernel.execute_tool("email.delete", {"id": eid}, actor="user")


@app.post("/api/analyze/upload")
async def analyze_upload(file: UploadFile = File(...)):
    import pathlib, shutil, tempfile
    from ..agent import brain
    suffix = pathlib.Path(file.filename or "file").suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = pathlib.Path(tmp.name)
    try:
        IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"}
        if suffix in IMAGE_EXT:
            result = brain.chat_vision("Describe this image in detail. Note any text, charts, objects, or context.", tmp_path)
        else:
            TEXT = {".txt", ".md", ".csv", ".json", ".py", ".js", ".ts", ".html", ".css", ".sql", ".xml", ".yaml", ".yml"}
            try:
                if suffix in TEXT:
                    text = tmp_path.read_text(encoding="utf-8", errors="replace")
                elif suffix in (".docx", ".doc"):
                    from docx import Document
                    text = "\n".join(p.text for p in Document(str(tmp_path)).paragraphs if p.text)
                elif suffix == ".pdf":
                    from pypdf import PdfReader
                    text = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(tmp_path)).pages)
                else:
                    text = tmp_path.read_text(encoding="utf-8", errors="replace")
            except Exception as exc:
                return {"ok": False, "error": str(exc), "filename": file.filename}
            prompt = f"File: {file.filename}\n\n---\n{text[:14000]}\n---\n\nSummarise the key points and any important information in this document."
            result = brain.chat(prompt, max_tokens=1500)
        return {"ok": result.get("ok", False), "filename": file.filename, "reply": result.get("reply", ""), "error": result.get("error") if not result.get("ok") else None}
    finally:
        try: tmp_path.unlink()
        except: pass


# --- alerts (Emblem comes alive when something happens) ---------------------------
@app.get("/api/alerts")
def alerts_unseen():
    from .. import alerts
    return {"items": alerts.unseen()}


@app.get("/api/alerts/recent")
def alerts_recent():
    from .. import alerts
    return {"items": alerts.recent()}


@app.post("/api/alerts/{aid}/seen")
def alerts_mark_seen(aid: int):
    from .. import alerts
    alerts.mark_seen(aid)
    return {"ok": True}


# --- improvements (Emblem's "teach me" log; operator surface) ----------------------
@app.get("/api/improvements")
def improvements_list():
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import improve
    return improve.listing("all")


@app.post("/api/improvements/{iid}/resolve")
def improvements_resolve(iid: int):
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import improve
    return improve.resolve(iid)


# --- conversation history (chat persists across sessions) -------------------------
class ConvIn(BaseModel):
    role: str
    text: str = ""


@app.get("/api/conversations")
def conversations_list(limit: int = 100):
    from ..kernel import data as db
    if _ctx.multiuser():
        rows = db.query("SELECT id, role, text, created_at FROM conversations WHERE user_id = ? "
                        "ORDER BY id DESC LIMIT ?", (_ctx.require_user(), limit))
    else:
        rows = db.query("SELECT id, role, text, created_at FROM conversations ORDER BY id DESC LIMIT ?", (limit,))
    return {"items": list(reversed(rows))}


@app.post("/api/conversations")
def conversations_add(b: ConvIn):
    from ..kernel import data as db
    if b.role in ("user", "assistant") and (b.text or "").strip():
        if _ctx.multiuser():
            db.write("INSERT INTO conversations (role, text, user_id) VALUES (?, ?, ?)",
                     (b.role, b.text[:8000], _ctx.require_user()))
        else:
            db.write("INSERT INTO conversations (role, text) VALUES (?, ?)", (b.role, b.text[:8000]))
    return {"ok": True}


@app.delete("/api/conversations")
def conversations_clear():
    from ..kernel import data as db
    if _ctx.multiuser():
        db.write("DELETE FROM conversations WHERE user_id = ?", (_ctx.require_user(),))
    else:
        db.write("DELETE FROM conversations", ())
    return {"ok": True}


# (duplicate legacy /api/memory GET/POST removed — the scoped routes above are canonical)
@app.get("/api/memory/recall")
def memory_recall(q: str = ""):
    from ..memory import store
    return {"items": store.recall(q, 6)}


# --- code sessions (auto-saved editor buffers, retrievable) ----------------------
class CodeIn(BaseModel):
    path: str
    content: str = ""
    language: str = ""
    name: str = ""


@app.get("/api/code")
def code_list():
    from ..tools import code
    return code.listing()


@app.post("/api/code")
def code_save(b: CodeIn):
    from ..tools import code
    return code.save(b.path, b.content, b.language, b.name)


@app.get("/api/code/get")
def code_get(path: str = "", name: str = ""):
    from ..tools import code
    return code.get(path, name)


@app.get("/api/code/search")
def code_search(q: str = ""):
    from ..tools import code
    return code.search(q)


# --- scheduled / recurring tasks -------------------------------------------------
@app.get("/api/schedule")
def schedule_list():
    from ..tools import schedule
    return schedule.listing()


@app.post("/api/schedule/{tid}/cancel")
def schedule_cancel(tid: int):
    from ..tools import schedule
    return schedule.cancel(tid)


class SchedulePause(BaseModel):
    paused: bool = True


@app.post("/api/schedule/{tid}/pause")
def schedule_pause(tid: int, body: SchedulePause):
    from ..tools import schedule
    return schedule.pause(tid, body.paused)


# --- raw file bytes (for the in-app document viewer; operator filesystem) ---------
@app.get("/api/file/raw")
def file_raw(root: str = "documents", path: str = ""):
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import fsutil
    try:
        target = fsutil.resolve(root, path)
    except Exception:
        return Response(status_code=400)
    if not target.exists() or not target.is_file():
        return Response(status_code=404)
    return FileResponse(str(target), headers={"Cache-Control": "no-store"})


# --- files overview (the "Files" page; operator filesystem) -----------------------
@app.get("/api/files/all")
def files_all():
    if not _ctx.is_owner():
        return _owner_404()
    from ..tools import fsutil
    roots = []
    for name, base in fsutil.ROOTS.items():
        items = []
        if base.exists():
            for p in sorted(base.rglob("*")):
                if p.is_file():
                    st = p.stat()
                    items.append({"path": p.relative_to(base).as_posix(), "name": p.name,
                                  "size": st.st_size, "updated": int(st.st_mtime)})
        roots.append({"root": name, "dir": str(base), "count": len(items), "items": items})
    return {"roots": roots}


# --- skills library --------------------------------------------------------------
import re as _re

SKILLS_DIR = paths.ROOT / "skills"


def _front(text: str) -> dict:
    m = _re.match(r"^---\s*\n(.*?)\n---\s*\n", text, _re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return meta


@app.get("/api/skills")
def skills():
    if not _ctx.is_owner():
        return _owner_404()
    out = []
    if SKILLS_DIR.exists():
        for p in sorted(SKILLS_DIR.rglob("*.md")):
            if p.name.upper() == "SKILLS.MD":
                continue
            meta = _front(p.read_text(encoding="utf-8", errors="replace"))
            rel = p.relative_to(SKILLS_DIR).as_posix()
            out.append({"path": rel, "name": meta.get("name", p.stem),
                        "description": meta.get("description", ""),
                        "category": rel.split("/")[0] if "/" in rel else "general"})
    return {"skills": out}


@app.get("/api/skill")
def skill(path: str = ""):
    if not _ctx.is_owner():
        return _owner_404()
    target = (SKILLS_DIR / path).resolve()
    if SKILLS_DIR.resolve() not in target.parents or not target.exists():
        return {"ok": False, "error": "Skill not found."}
    return {"ok": True, "path": path, "content": target.read_text(encoding="utf-8", errors="replace")}


# --- Connections (Composio, per-user) ------------------------------------------------

@app.get("/api/connections")
def connections_list():
    """Featured toolkits + which ones THIS user has connected (for the Connections page)."""
    try:
        from ..connectors import composio_tools
        connected = composio_tools.list_connections()
        featured = composio_tools.FEATURED_TOOLKITS
        return {
            "configured": composio_tools.configured(),
            "featured": featured,
            "connected": connected,
            "all": composio_tools.get_all_app_names(),
        }
    except Exception as e:
        return {"configured": False, "featured": [], "connected": [], "all": [], "error": str(e)}


@app.get("/api/connections/link")
def connections_link(toolkit: str = ""):
    """Start hosted OAuth for a toolkit for the current user. Returns the redirect URL."""
    if not toolkit:
        return {"ok": False, "error": "toolkit required"}
    try:
        from ..connectors import composio_tools
        url = composio_tools.initiate_connection(toolkit)
        if url:
            return {"ok": True, "url": url}
        return {"ok": False, "error": "Could not start OAuth — is COMPOSIO_KEY set?"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# Back-compat aliases (old frontend called /api/composio/*)
@app.get("/api/composio/apps")
def composio_apps():
    data = connections_list()
    return {"apps": data.get("all", []), "connected": data.get("connected", [])}


@app.get("/api/composio/connect")
def composio_connect(app_name: str = ""):
    return connections_link(app_name)


@app.get("/api/composio/status")
def composio_status():
    from ..connectors import composio_tools
    return {"connected": composio_tools.list_connections()}


class ComposioExecRequest(BaseModel):
    action: str
    params: dict = {}
    entity_id: str = "default"   # ignored — the authenticated user is always the entity


@app.post("/api/composio/execute")
def composio_execute(req: ComposioExecRequest):
    """Execute a connected-app action AS THE CURRENT USER, through the kernel gate.
    entity_id from the client is deliberately ignored (no acting as someone else), and
    consequential actions stop for the user's approval exactly like agent-initiated ones."""
    from ..connectors.composio_kernel import is_read_only
    gate = "composio.read" if is_read_only(req.action) else "composio.act"
    try:
        result = kernel.execute_tool(gate, {"slug": req.action, "params": req.params}, actor="user")
        return {"ok": True, "result": result.get("result")}
    except ApprovalRequired as exc:
        return {"ok": False, "approval_required": True,
                "approval_id": exc.approval_id, "summary": exc.summary}
    except ApprovalRejected as exc:
        return {"ok": False, "rejected": True, "approval_id": exc.approval_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# --- Gemini TTS route ----------------------------------------------------------------

class GeminiTTSRequest(BaseModel):
    text: str
    voice: str = "en-US-Studio-O"
    language_code: str = "en-US"


@app.post("/api/voice/gemini-tts")
async def gemini_tts(req: GeminiTTSRequest):
    """Google Cloud TTS using the Gemini/Google API key from vault."""
    try:
        import httpx
        key = vault.get_secret("gemini_key") or vault.get_secret("google_key")
        if not key:
            return Response(status_code=503, content="No Gemini key configured")

        payload = {
            "input": {"text": req.text},
            "voice": {"languageCode": req.language_code, "name": req.voice},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": 1.0},
        }
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"https://texttospeech.googleapis.com/v1/text:synthesize?key={key}",
                json=payload,
            )
        if r.status_code != 200:
            _log.warning("Gemini TTS error: %s %s", r.status_code, r.text[:200])
            return Response(status_code=502, content="TTS upstream error")

        import base64
        audio_b64 = r.json().get("audioContent", "")
        audio_bytes = base64.b64decode(audio_b64)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        _log.error("Gemini TTS exception: %s", e)
        return Response(status_code=500, content=str(e))


# --- Realtime voice (provider-blind WebSocket bridge) ----------------------------
@app.websocket("/api/voice/live")
async def voice_live(ws: WebSocket):
    from ..voice import gemini_live
    await gemini_live.bridge(ws)


# --- Pages (Notion-style, per-user) ----------------------------------------------
class PageIn(BaseModel):
    title: str = "Untitled"
    blocks: list = []
    icon: str = ""


class PagePatch(BaseModel):
    title: str | None = None
    blocks: list | None = None
    icon: str | None = None


@app.get("/api/pages")
def pages_list():
    from ..tools import pages
    return {"items": pages.listing()}


@app.post("/api/pages")
def pages_create(b: PageIn):
    from ..tools import pages
    return pages.create(b.title, b.blocks, b.icon)


@app.get("/api/pages/{pid}")
def pages_get(pid: int):
    from ..tools import pages
    return pages.get(pid)


@app.put("/api/pages/{pid}")
def pages_update(pid: int, b: PagePatch):
    from ..tools import pages
    return pages.update(pid, b.title, b.blocks, b.icon)


@app.delete("/api/pages/{pid}")
def pages_delete(pid: int):
    from ..tools import pages
    return pages.archive(pid)


# --- Calendar (native, per-user) -------------------------------------------------
class EventIn(BaseModel):
    title: str = ""
    starts_at: str
    ends_at: str | None = None
    all_day: bool = False
    remind_secs: int | None = None


@app.get("/api/calendar")
def calendar_list_ep():
    from ..tools import calendar
    return {"items": calendar.listing()}


@app.post("/api/calendar")
def calendar_add_ep(b: EventIn):
    from ..tools import calendar
    return calendar.create(b.title, b.starts_at, b.ends_at, b.all_day, b.remind_secs)


@app.delete("/api/calendar/{eid}")
def calendar_delete_ep(eid: int):
    from ..tools import calendar
    return calendar.delete(eid)


# --- Automations (per-user recurring tasks) --------------------------------------
class AutomationIn(BaseModel):
    title: str = ""
    instruction: str
    every: str = "day"


@app.get("/api/automations")
def automations_list_ep():
    from ..tools import automations
    return {"items": automations.listing()}


@app.post("/api/automations")
def automations_create_ep(b: AutomationIn):
    from ..tools import automations
    return automations.create(b.title, b.instruction, b.every)


class AutoToggle(BaseModel):
    enabled: bool = True


@app.post("/api/automations/{aid}/toggle")
def automations_toggle_ep(aid: int, b: AutoToggle):
    from ..tools import automations
    return automations.set_enabled(aid, b.enabled)


@app.delete("/api/automations/{aid}")
def automations_delete_ep(aid: int):
    from ..tools import automations
    return automations.delete(aid)


# --- serve the frontend same-origin (must be mounted last) -----------------------
# Prefer the built Svelte app (frontend/dist); fall back to the legacy root UI.
_dist = paths.ROOT / "frontend" / "dist"
if (_dist / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")
elif (paths.ROOT / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(paths.ROOT), html=True), name="static")
# In the cloud (no bundled frontend) we stay API-only — no static mount, nothing exposed.
