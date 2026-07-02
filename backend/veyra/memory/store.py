"""Memory storage + semantic recall."""

import json
import math

import httpx

from ..kernel import db, Tier, tool
from ..kernel import context

OLLAMA_URL = "http://127.0.0.1:11434"
EMBED_MODEL = "nomic-embed-text"


def _embed(text):
    try:
        r = httpx.post(f"{OLLAMA_URL}/api/embeddings",
                       json={"model": EMBED_MODEL, "prompt": text}, timeout=20)
        return r.json().get("embedding")
    except Exception:
        return None


def _cos(a, b):
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def remember(content, kind="fact", source="user", memory_id=None):
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "Content is required."}
    emb = _embed(content)

    if memory_id:
        # Ownership check: users may only update their own memories.
        if context.multiuser():
            old = db.one("SELECT content, kind FROM memory WHERE id = ? AND user_id = ?",
                         (memory_id, context.require_user()))
        else:
            old = db.one("SELECT content, kind FROM memory WHERE id = ?", (memory_id,))
        if not old:
            return {"ok": False, "error": "Memory not found."}
        try:
            db.write(
                "INSERT INTO memory_versions (memory_id, content, kind) VALUES (?, ?, ?)",
                (memory_id, old["content"], old["kind"]),
            )
        except Exception:
            pass  # memory_versions table may not exist yet — non-fatal
        if context.multiuser():
            db.write(
                "UPDATE memory SET content = ?, kind = ?, embedding = ?, source = ? "
                "WHERE id = ? AND user_id = ?",
                (content, kind, json.dumps(emb) if emb else None, source, memory_id,
                 context.require_user()),
            )
        else:
            db.write(
                "UPDATE memory SET content = ?, kind = ?, embedding = ?, source = ? WHERE id = ?",
                (content, kind, json.dumps(emb) if emb else None, source, memory_id),
            )
        return {"ok": True, "id": memory_id, "updated": True}

    if context.multiuser():
        mid = db.write(
            "INSERT INTO memory (kind, content, embedding, source, user_id) VALUES (?, ?, ?, ?, ?)",
            (kind, content, json.dumps(emb) if emb else None, source, context.require_user()),
        )
    else:
        mid = db.write(
            "INSERT INTO memory (kind, content, embedding, source) VALUES (?, ?, ?, ?)",
            (kind, content, json.dumps(emb) if emb else None, source),
        )
    return {"ok": True, "id": mid}


def recall(query, k=5):
    if context.multiuser():
        rows = db.query("SELECT id, kind, content, embedding, source, created_at "
                        "FROM memory WHERE deleted = 0 AND user_id = ? ORDER BY id DESC LIMIT 800",
                        (context.require_user(),))
    else:
        rows = db.query("SELECT id, kind, content, embedding, source, created_at "
                        "FROM memory WHERE deleted = 0 ORDER BY id DESC LIMIT 800")
    if not rows:
        return []
    qv = _embed(query)
    if qv:
        scored = []
        for r in rows:
            try:
                ev = json.loads(r["embedding"]) if r["embedding"] else None
            except Exception:
                ev = None
            scored.append((_cos(qv, ev), r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"id": r["id"], "kind": r["kind"], "content": r["content"], "score": round(s, 3)}
                for s, r in scored[:k] if s > 0.35]
    # keyword fallback
    words = [w for w in query.lower().split() if len(w) > 2]
    hits = [r for r in rows if any(w in r["content"].lower() for w in words)]
    return [{"id": r["id"], "kind": r["kind"], "content": r["content"]} for r in hits[:k]]


def listing(limit=200, include_deleted=False):
    if context.multiuser():
        uid = context.require_user()
        if include_deleted:
            return db.query("SELECT id, kind, content, source, deleted, created_at "
                            "FROM memory WHERE user_id = ? ORDER BY id DESC LIMIT ?", (uid, limit))
        return db.query("SELECT id, kind, content, source, created_at "
                        "FROM memory WHERE deleted = 0 AND user_id = ? ORDER BY id DESC LIMIT ?", (uid, limit))
    if include_deleted:
        return db.query("SELECT id, kind, content, source, deleted, created_at "
                        "FROM memory ORDER BY id DESC LIMIT ?", (limit,))
    return db.query("SELECT id, kind, content, source, created_at "
                    "FROM memory WHERE deleted = 0 ORDER BY id DESC LIMIT ?", (limit,))


@tool("memory.delete", Tier.CAUTION,
      "Forget a stored memory entry by its ID (soft-delete; recoverable via versions)",
      summarize=lambda a: f"Delete memory #{a.get('id')}")
def delete(mid: int = 0, id: int = 0):
    target = mid or id
    if not target:
        return {"ok": False, "error": "Provide the memory id to delete."}
    if context.multiuser():
        db.write("UPDATE memory SET deleted = 1 WHERE id = ? AND user_id = ?",
                 (target, context.require_user()))
    else:
        db.write("UPDATE memory SET deleted = 1 WHERE id = ?", (target,))
    return {"ok": True, "id": target}


def versions(mid: int):
    try:
        if context.multiuser():
            # Only versions of memories the current user owns.
            return db.query(
                "SELECT v.id, v.memory_id, v.content, v.kind, v.created_at "
                "FROM memory_versions v JOIN memory m ON m.id = v.memory_id "
                "WHERE v.memory_id = ? AND m.user_id = ? ORDER BY v.id DESC",
                (mid, context.require_user()))
        return db.query("SELECT id, memory_id, content, kind, created_at "
                        "FROM memory_versions WHERE memory_id = ? ORDER BY id DESC", (mid,))
    except Exception:
        return []


def rollback(mid: int, version_id: int):
    """Restore a memory entry to a specific saved version."""
    ver = db.one("SELECT content, kind FROM memory_versions WHERE id = ? AND memory_id = ?",
                 (version_id, mid))
    if not ver:
        return {"ok": False, "error": "Version not found."}
    return remember(ver["content"], ver["kind"], source="rollback", memory_id=mid)
