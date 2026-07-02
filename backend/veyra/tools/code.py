"""Code session persistence.

Every piece of code Veyra writes (or the user edits) is mirrored into the database so it
can never be lost on a remount, navigation, or app restart — and so it can be retrieved
later by name or by searching its contents. The on-disk copy under workspaces/ still happens
through files.write when explicitly saved; this layer is the always-on safety net.

Multi-user: every session belongs to a user; paths are unique per user, and all reads and
writes are scoped to the current request's user.
"""

from ..kernel import Tier, context, tool
from ..kernel import data as db   # shared store when configured; local SQLite otherwise


def _name_from(path: str) -> str:
    return (path or "").replace("\\", "/").split("/")[-1] or "untitled"


@tool("code.save", Tier.SAFE, "Persist a code buffer (auto-save; upsert by path)",
      summarize=lambda a: f"Save code {a.get('path')}")
def save(path: str, content: str = "", language: str = "", name: str = "", tags: str = "") -> dict:
    if not path:
        return {"ok": False, "error": "A path is required."}
    name = name or _name_from(path)
    if context.multiuser():
        uid = context.require_user()
        existing = db.one("SELECT id FROM code_sessions WHERE path = ? AND user_id = ?", (path, uid))
        if existing:
            db.write(
                "UPDATE code_sessions SET content = ?, language = ?, name = ?, "
                "tags = CASE WHEN ? <> '' THEN ? ELSE tags END, updated_at = datetime('now') "
                "WHERE id = ? AND user_id = ?",
                (content or "", language or "", name, tags or "", tags or "", existing["id"], uid),
            )
        else:
            db.write(
                "INSERT INTO code_sessions (path, name, language, content, tags, user_id, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (path, name, language or "", content or "", tags or "", uid),
            )
        return {"ok": True, "path": path, "bytes": len(content or "")}
    db.write(
        """INSERT INTO code_sessions (path, name, language, content, tags, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(path) DO UPDATE SET
             content = excluded.content,
             language = excluded.language,
             name = excluded.name,
             tags = CASE WHEN excluded.tags <> '' THEN excluded.tags ELSE code_sessions.tags END,
             updated_at = datetime('now')""",
        (path, name, language or "", content or "", tags or ""),
    )
    return {"ok": True, "path": path, "bytes": len(content or "")}


@tool("code.list", Tier.SAFE, "List saved code sessions (newest first)")
def listing() -> dict:
    if context.multiuser():
        rows = db.query("SELECT id, path, name, language, tags, updated_at, "
                        "length(content) AS size FROM code_sessions WHERE user_id = ? "
                        "ORDER BY updated_at DESC LIMIT 200", (context.require_user(),))
    else:
        rows = db.query("SELECT id, path, name, language, tags, updated_at, "
                        "length(content) AS size FROM code_sessions ORDER BY updated_at DESC LIMIT 200")
    return {"ok": True, "items": rows}


@tool("code.get", Tier.SAFE, "Get one saved code session by path or name")
def get(path: str = "", name: str = "") -> dict:
    row = None
    if context.multiuser():
        uid = context.require_user()
        if path:
            row = db.one("SELECT * FROM code_sessions WHERE path = ? AND user_id = ?", (path, uid))
        if not row and name:
            row = db.one("SELECT * FROM code_sessions WHERE (name = ? OR path LIKE ?) AND user_id = ? "
                         "ORDER BY updated_at DESC LIMIT 1", (name, f"%{name}%", uid))
    else:
        if path:
            row = db.one("SELECT * FROM code_sessions WHERE path = ?", (path,))
        if not row and name:
            row = db.one("SELECT * FROM code_sessions WHERE name = ? OR path LIKE ? "
                         "ORDER BY updated_at DESC LIMIT 1", (name, f"%{name}%"))
    if not row:
        return {"ok": False, "error": "No saved code found."}
    return {"ok": True, **row}


@tool("code.search", Tier.SAFE, "Search saved code by name, path, tags, or content")
def search(query: str = "", max_results: int = 20) -> dict:
    q = f"%{(query or '').strip()}%"
    if context.multiuser():
        rows = db.query(
            "SELECT id, path, name, language, tags, updated_at, length(content) AS size, "
            "substr(content, 1, 200) AS preview FROM code_sessions "
            "WHERE (name LIKE ? OR path LIKE ? OR tags LIKE ? OR content LIKE ?) AND user_id = ? "
            "ORDER BY updated_at DESC LIMIT ?",
            (q, q, q, q, context.require_user(), max_results),
        )
    else:
        rows = db.query(
            "SELECT id, path, name, language, tags, updated_at, length(content) AS size, "
            "substr(content, 1, 200) AS preview FROM code_sessions "
            "WHERE name LIKE ? OR path LIKE ? OR tags LIKE ? OR content LIKE ? "
            "ORDER BY updated_at DESC LIMIT ?",
            (q, q, q, q, max_results),
        )
    return {"ok": True, "query": query, "matches": rows}


@tool("code.delete", Tier.CAUTION, "Forget a saved code session",
      summarize=lambda a: f"Delete saved code {a.get('path')}")
def delete(path: str = "") -> dict:
    if context.multiuser():
        db.write("DELETE FROM code_sessions WHERE path = ? AND user_id = ?",
                 (path, context.require_user()))
    else:
        db.write("DELETE FROM code_sessions WHERE path = ?", (path,))
    return {"ok": True, "path": path}
