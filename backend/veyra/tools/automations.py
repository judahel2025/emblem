"""Automations — user-defined recurring proactive tasks.

An automation is a natural-language instruction the agent runs on an interval
("every morning summarize my unread email and DM me"). Stored per user in the
`automations` table; the scheduler wakes them, runs them through the agent as that
user, honours quiet hours, and never stacks overlapping runs.
"""

from ..kernel import Tier, tool, context
from ..kernel import data as db

_EVERY = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800}


def _uid():
    return context.require_user()


def create(title, instruction, every="day", quiet_aware=True):
    secs = _EVERY.get(every, 86400)
    aid = db.write(
        "INSERT INTO automations (title, instruction, every_secs, quiet_aware, user_id) "
        "VALUES (?, ?, ?, ?, ?)",
        (title or instruction[:40], instruction, secs, bool(quiet_aware), _uid()),
    )
    return {"ok": True, "id": aid}


def listing():
    return db.query(
        "SELECT id, title, instruction, every_secs, enabled, next_run, last_run, last_result "
        "FROM automations WHERE user_id = ? ORDER BY id DESC LIMIT 100",
        (_uid(),),
    )


def set_enabled(automation_id, enabled):
    db.write("UPDATE automations SET enabled = ? WHERE id = ? AND user_id = ?",
             (bool(enabled), automation_id, _uid()))
    return {"ok": True}


def delete(automation_id):
    db.write("DELETE FROM automations WHERE id = ? AND user_id = ?", (automation_id, _uid()))
    return {"ok": True}


@tool("automation.create", Tier.CAUTION,
      "Create a recurring automation that runs an instruction on a schedule.",
      summarize=lambda a: f"Automate: {a.get('instruction', '')[:50]} ({a.get('every', 'day')})")
def automation_create(title="", instruction="", every="day"):
    if not instruction:
        return {"ok": False, "error": "instruction required"}
    return create(title, instruction, every)


@tool("automation.list", Tier.SAFE, "List the user's automations.")
def automation_list():
    return {"ok": True, "items": listing()}
