"""Scheduled / recurring tasks.

Lets Veyra set up real recurring work — "send this every morning for 7 days" — that fires
on its own. These tools manage the queue; veyra/scheduler.py is the background runner that
actually executes due tasks (locally in the desktop engine, and in the cloud via Supabase).
"""

import json

from ..kernel import Tier, context, tool
from ..kernel import db


def _uid():
    """Current user id in multiuser mode, else None (single-user local build)."""
    return context.require_user() if context.multiuser() else None

# Friendly interval words -> seconds.
EVERY = {
    "minute": 60, "hour": 3600, "hourly": 3600,
    "day": 86400, "daily": 86400, "week": 604800, "weekly": 604800,
}


def _every_secs(every) -> int:
    if isinstance(every, (int, float)):
        return max(60, int(every))
    return EVERY.get(str(every or "day").strip().lower(), 86400)


@tool("schedule.create", Tier.SAFE,
      "Create a recurring task that fires a tool on an interval for a number of runs",
      summarize=lambda a: f"Schedule '{a.get('title', a.get('tool'))}' x{a.get('count', 1)}")
def create(title: str = "", tool: str = "", args: dict = None, every="day",
           count: int = 1, first_delay_secs: int = 0, where: str = "local") -> dict:
    if not tool:
        return {"ok": False, "error": "A tool to run is required."}
    secs = _every_secs(every)
    delay = max(0, int(first_delay_secs or 0))
    total = max(1, int(count or 1))
    where = (where or "local").lower()

    # Cloud delegation: when asked to run in the cloud (so it fires with the PC off), push it to
    # the cloud store and keep the local row 'delegated' (visible, but not run locally) — no double.
    delegated = False
    if where in ("cloud", "both"):
        try:
            from .. import scheduler
            delegated = scheduler.mirror_to_cloud(title or tool, tool, args or {}, secs, total, delay)
        except Exception:
            delegated = False

    status = "delegated" if (delegated and where == "cloud") else "active"
    uid = _uid()
    if uid:
        tid = db.write(
            """INSERT INTO scheduled_tasks (title, tool, args_json, every_secs, next_run, runs_total, status, user_id)
               VALUES (?, ?, ?, ?, datetime('now', ?), ?, ?, ?)""",
            (title or tool, tool, json.dumps(args or {}), secs, f"+{delay} seconds", total, status, uid),
        )
    else:
        tid = db.write(
            """INSERT INTO scheduled_tasks (title, tool, args_json, every_secs, next_run, runs_total, status)
               VALUES (?, ?, ?, ?, datetime('now', ?), ?, ?)""",
            (title or tool, tool, json.dumps(args or {}), secs, f"+{delay} seconds", total, status),
        )
    return {"ok": True, "id": tid, "every_secs": secs, "runs_total": total,
            "where": where, "delegated_to_cloud": delegated}


@tool("schedule.list", Tier.SAFE, "List scheduled tasks")
def listing() -> dict:
    base = ("SELECT id, title, tool, args_json, every_secs, next_run, runs_done, "
            "runs_total, status, last_run, last_result, created_at FROM scheduled_tasks ")
    uid = _uid()
    if uid and not context.is_owner():
        rows = db.query(base + "WHERE user_id = ? ORDER BY (status='active') DESC, next_run ASC LIMIT 200",
                        (uid,))
    else:  # owner/admin (and local build) sees everything, including system monitors
        rows = db.query(base + "ORDER BY (status='active') DESC, next_run ASC LIMIT 200")
    for r in rows:
        try:
            r["args"] = json.loads(r.pop("args_json") or "{}")
        except Exception:
            r["args"] = {}
    return {"ok": True, "items": rows}


@tool("schedule.cancel", Tier.SAFE, "Cancel a scheduled task",
      summarize=lambda a: f"Cancel scheduled task #{a.get('id')}")
def cancel(id: int = 0) -> dict:
    uid = _uid()
    if uid and not context.is_owner():
        db.write("UPDATE scheduled_tasks SET status='cancelled' WHERE id = ? AND user_id = ?", (id, uid))
    else:
        db.write("UPDATE scheduled_tasks SET status='cancelled' WHERE id = ?", (id,))
    return {"ok": True, "id": id}


@tool("schedule.pause", Tier.SAFE, "Pause or resume a scheduled task")
def pause(id: int = 0, paused: bool = True) -> dict:
    uid = _uid()
    if uid and not context.is_owner():
        db.write("UPDATE scheduled_tasks SET status = ? WHERE id = ? AND user_id = ?",
                 ("paused" if paused else "active", id, uid))
    else:
        db.write("UPDATE scheduled_tasks SET status = ? WHERE id = ?",
                 ("paused" if paused else "active", id))
    return {"ok": True, "id": id, "status": "paused" if paused else "active"}
