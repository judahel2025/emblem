"""Pages — Notion-style documents, per user.

Each page is a title + a JSON list of blocks. Stored in the shared Postgres `pages`
table (created by the multi-user migration) and always scoped to the current user.
The agent can create/append/read pages from chat; the UI renders + edits them.
"""

import json

from ..kernel import Tier, tool, context
from ..kernel import data as db


def _uid():
    return context.require_user()


def create(title="Untitled", blocks=None, icon=""):
    blocks = blocks if isinstance(blocks, list) else []
    pid = db.write(
        "INSERT INTO pages (title, blocks, icon, user_id) VALUES (?, ?, ?, ?)",
        (title or "Untitled", json.dumps(blocks), icon or "", _uid()),
    )
    return {"ok": True, "id": pid}


def listing(limit=100):
    rows = db.query(
        "SELECT id, title, icon, updated_at FROM pages "
        "WHERE user_id = ? AND archived = FALSE ORDER BY updated_at DESC LIMIT ?",
        (_uid(), limit),
    )
    return rows


def get(page_id):
    row = db.one("SELECT id, title, blocks, icon, updated_at FROM pages WHERE id = ? AND user_id = ?",
                 (page_id, _uid()))
    if not row:
        return {"ok": False, "error": "not found"}
    try:
        row["blocks"] = json.loads(row["blocks"]) if isinstance(row.get("blocks"), str) else (row.get("blocks") or [])
    except Exception:
        row["blocks"] = []
    return {"ok": True, **row}


def update(page_id, title=None, blocks=None, icon=None):
    sets, params = [], []
    if title is not None:
        sets.append("title = ?"); params.append(title)
    if blocks is not None:
        sets.append("blocks = ?"); params.append(json.dumps(blocks))
    if icon is not None:
        sets.append("icon = ?"); params.append(icon)
    if not sets:
        return {"ok": False, "error": "nothing to update"}
    sets.append("updated_at = datetime('now')")
    params += [page_id, _uid()]
    db.write(f"UPDATE pages SET {', '.join(sets)} WHERE id = ? AND user_id = ?", tuple(params))
    return {"ok": True, "id": page_id}


def archive(page_id):
    db.write("UPDATE pages SET archived = TRUE WHERE id = ? AND user_id = ?", (page_id, _uid()))
    return {"ok": True}


@tool("page.create", Tier.SAFE, "Create a new page (Notion-style doc) for the user.",
      summarize=lambda a: f"Create page: {a.get('title', 'Untitled')}")
def page_create(title="Untitled", content="", icon=""):
    # `content` is markdown; store as a single text block so chat can create pages simply.
    blocks = [{"type": "text", "text": content}] if content else []
    return create(title, blocks, icon)


@tool("page.append", Tier.SAFE, "Append a paragraph/section to an existing page.",
      summarize=lambda a: f"Append to page #{a.get('id')}")
def page_append(id: int = 0, text: str = ""):
    cur = get(id)
    if not cur.get("ok"):
        return cur
    blocks = cur.get("blocks", [])
    blocks.append({"type": "text", "text": text})
    return update(id, blocks=blocks)


@tool("page.list", Tier.SAFE, "List the user's pages.")
def page_list():
    return {"ok": True, "items": listing()}
