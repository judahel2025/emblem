"""Email drafts — local Inbox composing. Veyra writes mail here; sending stays gated/manual
until a real Gmail connector is set up. Safe tier (drafting is harmless).
"""

from ..kernel import Tier, tool
from ..kernel import data as db   # shared store when configured; local SQLite otherwise


def add_draft(recipient="", subject="", body=""):
    eid = db.write("INSERT INTO emails (recipient, subject, body, status) VALUES (?, ?, ?, 'draft')",
                   (recipient or "", subject or "", body or ""))
    return {"ok": True, "id": eid}


def listing(status=None):
    if status and status != "all":
        return db.query("SELECT id, recipient, subject, body, status, created_at "
                        "FROM emails WHERE status = ? ORDER BY id DESC LIMIT 200", (status,))
    return db.query("SELECT id, recipient, subject, body, status, created_at "
                    "FROM emails WHERE status != 'deleted' ORDER BY id DESC LIMIT 200")


def get_one(eid):
    return db.one("SELECT id, recipient, subject, body, status FROM emails WHERE id = ?", (eid,))


def mark_sent(eid):
    db.write("UPDATE emails SET status='sent' WHERE id = ?", (eid,))


@tool("email.archive", Tier.SAFE, "Archive an email (hide from the active inbox)",
      summarize=lambda a: f"Archive email #{a.get('id')}")
def archive(id=0):
    db.write("UPDATE emails SET status='archived' WHERE id = ?", (id,))
    return {"ok": True, "id": id, "status": "archived"}


@tool("email.restore", Tier.SAFE, "Restore an archived or deleted email back to drafts")
def restore(id=0):
    db.write("UPDATE emails SET status='draft' WHERE id = ?", (id,))
    return {"ok": True, "id": id, "status": "draft"}


@tool("email.delete", Tier.CAUTION, "Delete an email draft",
      summarize=lambda a: f"Delete email #{a.get('id')}", target=lambda a: f"email #{a.get('id')}")
def delete(id=0):
    # soft-delete so it can be restored; the inbox hides 'deleted'
    db.write("UPDATE emails SET status='deleted' WHERE id = ?", (id,))
    return {"ok": True, "id": id, "status": "deleted"}


@tool("email.clear_drafts", Tier.CAUTION,
      "Delete ALL email drafts at once. Use when user says 'clear drafts', 'delete all drafts'.",
      summarize=lambda a: "Clear all email drafts")
def clear_drafts():
    rows = db.query("SELECT id FROM emails WHERE status = 'draft'", ())
    count = len(rows)
    db.write("UPDATE emails SET status = 'deleted' WHERE status = 'draft'", ())
    return {"ok": True, "cleared_count": count, "action": "drafts.cleared"}


@tool("inbox.bulk_read", Tier.SAFE,
      "Mark multiple inbox messages as read by ID list",
      summarize=lambda a: f"Mark {len(a.get('ids', []))} messages read")
def inbox_bulk_read(ids: list = None):
    from ..connectors import mailroom
    ids = [int(i) for i in (ids or []) if i]
    if not ids:
        return {"ok": False, "error": "Provide a list of message IDs."}
    count = mailroom.bulk_mark_read(ids)
    return {"ok": True, "marked_read": count}


@tool("inbox.bulk_archive", Tier.SAFE,
      "Archive multiple inbox messages by ID list",
      summarize=lambda a: f"Archive {len(a.get('ids', []))} messages")
def inbox_bulk_archive(ids: list = None):
    from ..connectors import mailroom
    ids = [int(i) for i in (ids or []) if i]
    if not ids:
        return {"ok": False, "error": "Provide a list of message IDs."}
    count = mailroom.bulk_archive(ids)
    return {"ok": True, "archived": count}


_PLACEHOLDER_DOMAINS = {"example.com", "example.org", "example.net", "test.com", "placeholder.com"}


@tool("email.draft", Tier.SAFE, "Write an email draft into the Inbox",
      summarize=lambda a: f"Draft email to {a.get('recipient', '')}: {a.get('subject', '')[:40]}")
def draft(recipient="", subject="", body=""):
    if recipient and "@" in recipient:
        domain = recipient.split("@")[-1].lower().strip()
        if domain in _PLACEHOLDER_DOMAINS:
            return {
                "ok": False,
                "error": (
                    f"'{recipient}' is a placeholder address — not a real inbox. "
                    f"The owner's personal email is alliesjude@gmail.com. "
                    f"Ask for the correct recipient before drafting."
                ),
            }
    return add_draft(recipient, subject, body)


@tool("email.list", Tier.SAFE, "List email drafts")
def list_tool():
    return {"ok": True, "items": listing()}


@tool("inbox.delete_all", Tier.CAUTION,
      "Delete every message in the inbox (mail_messages table). Use when user says 'delete inbox', 'clear inbox', etc.",
      summarize=lambda a: "Delete all inbox messages")
def inbox_delete_all():
    rows = db.query("SELECT id FROM mail_messages", ())
    count = len(rows)
    db.write("DELETE FROM mail_messages", ())
    return {"ok": True, "deleted_count": count, "action": "inbox.cleared", "count": count}


@tool("conversations.clear", Tier.CAUTION,
      "Delete all conversation history. Use when user says 'clear chat', 'delete chat history', 'clear all chats'.",
      summarize=lambda a: "Clear all conversation history")
def conversations_clear():
    db.write("DELETE FROM conversations", ())
    return {"ok": True, "action": "conversations.cleared"}


@tool("conversations.clear_range", Tier.CAUTION,
      "Delete conversation messages within a date range. from_date and to_date are ISO strings (YYYY-MM-DD).",
      summarize=lambda a: f"Clear chat history {a.get('from_date','start')} to {a.get('to_date','now')}")
def conversations_clear_range(from_date="", to_date=""):
    if from_date and to_date:
        db.write("DELETE FROM conversations WHERE created_at BETWEEN ? AND ?",
                 (from_date + " 00:00:00", to_date + " 23:59:59"))
    elif from_date:
        db.write("DELETE FROM conversations WHERE created_at >= ?", (from_date + " 00:00:00",))
    elif to_date:
        db.write("DELETE FROM conversations WHERE created_at <= ?", (to_date + " 23:59:59",))
    return {"ok": True, "action": "conversations.cleared"}


@tool("memory.clear_document", Tier.SAFE,
      "Remove stored memory entries for a specific document by filename.",
      summarize=lambda a: f"Clear memory for document: {a.get('filename','')}")
def memory_clear_document(filename=""):
    if not filename:
        return {"ok": False, "error": "filename required"}
    db.write("DELETE FROM memory WHERE content LIKE ?", (f'%"{filename}"%',))
    return {"ok": True}
