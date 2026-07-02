"""Notes — a local Google-Keep-style store. Safe tier: no gating needed.

Voice/agent can save notes ("note that…", "save this to my notes") and the Notes page
reads them back. Everything lives in the local kernel DB.
"""

from ..kernel import Tier, tool
from ..kernel import context
from ..kernel import data as db   # shared store when configured; local SQLite otherwise


def add(title="", body="", color="default"):
    if context.multiuser():
        nid = db.write("INSERT INTO notes (title, body, color, user_id) VALUES (?, ?, ?, ?)",
                       (title or "", body or "", color or "default", context.require_user()))
    else:
        nid = db.write("INSERT INTO notes (title, body, color) VALUES (?, ?, ?)",
                       (title or "", body or "", color or "default"))
    return {"ok": True, "id": nid}


def listing():
    if context.multiuser():
        return db.query("SELECT id, title, body, color, pinned, created_at, updated_at "
                        "FROM notes WHERE user_id = ? ORDER BY pinned DESC, id DESC LIMIT 300",
                        (context.require_user(),))
    return db.query("SELECT id, title, body, color, pinned, created_at, updated_at "
                    "FROM notes ORDER BY pinned DESC, id DESC LIMIT 300")


def update(note_id, **fields):
    cols = [k for k in ("title", "body", "color", "pinned") if k in fields]
    if not cols:
        return {"ok": False}
    sets = ", ".join(f"{c} = ?" for c in cols) + ", updated_at = datetime('now')"
    if context.multiuser():
        db.write(f"UPDATE notes SET {sets} WHERE id = ? AND user_id = ?",
                 (*[fields[c] for c in cols], note_id, context.require_user()))
    else:
        db.write(f"UPDATE notes SET {sets} WHERE id = ?", (*[fields[c] for c in cols], note_id))
    return {"ok": True}


def delete(note_id):
    if context.multiuser():
        db.write("DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, context.require_user()))
    else:
        db.write("DELETE FROM notes WHERE id = ?", (note_id,))
    return {"ok": True}


@tool("notes.add", Tier.SAFE, "Save a note to local Notes",
      summarize=lambda a: f"Note: {(a.get('body') or a.get('title') or '')[:60]}")
def add_tool(title="", body="", color="default"):
    return add(title, body, color)


@tool("notes.list", Tier.SAFE, "List saved notes")
def list_tool():
    return {"ok": True, "items": listing()}
