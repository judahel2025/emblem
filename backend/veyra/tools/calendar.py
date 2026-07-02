"""Calendar — native per-user events. Google Calendar syncs in via Composio separately.

Events live in the shared `calendar_events` table (multi-user migration) and are always
scoped to the current user. Reminders are surfaced by the heartbeat/scheduler.
"""

from ..kernel import Tier, tool, context
from ..kernel import data as db


def _uid():
    return context.require_user()


def create(title, starts_at, ends_at=None, all_day=False, remind_secs=None):
    eid = db.write(
        "INSERT INTO calendar_events (title, starts_at, ends_at, all_day, remind_secs, user_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (title or "", starts_at, ends_at, bool(all_day), remind_secs, _uid()),
    )
    return {"ok": True, "id": eid}


def listing(limit=200):
    return db.query(
        "SELECT id, title, starts_at, ends_at, all_day, source FROM calendar_events "
        "WHERE user_id = ? ORDER BY starts_at ASC LIMIT ?",
        (_uid(), limit),
    )


def delete(event_id):
    db.write("DELETE FROM calendar_events WHERE id = ? AND user_id = ?", (event_id, _uid()))
    return {"ok": True}


@tool("calendar.add", Tier.SAFE, "Add an event to the user's calendar (ISO 8601 start time).",
      summarize=lambda a: f"Add event: {a.get('title')} @ {a.get('starts_at')}")
def calendar_add(title="", starts_at="", ends_at="", all_day=False, remind_secs=0):
    if not starts_at:
        return {"ok": False, "error": "starts_at (ISO time) required"}
    return create(title, starts_at, ends_at or None, all_day, remind_secs or None)


@tool("calendar.list", Tier.SAFE, "List upcoming calendar events for the user.")
def calendar_list():
    return {"ok": True, "items": listing()}
