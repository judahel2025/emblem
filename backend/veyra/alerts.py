"""Alerts — the feed that lets Veyra come alive on her own.

When something happens (a new support message, a signup, a product change), a connector raises
an alert here. The UI polls unseen alerts and, when one appears, Veyra speaks up unprompted and
asks whether to act. Also used to (optionally) email the operator the same alert.

Multi-user: every alert belongs to a user. Connector/heartbeat alerts (mailroom, Estoppel,
monitor — the operator's world) default to the admin/owner account; user-originated alerts
stamp the current request user. Reads are scoped to the current user.
"""

import json
import os

from .kernel import context
from .kernel import data as db   # shared store when configured; local SQLite otherwise

_OWNER_UID = os.environ.get("VEYRA_OWNER_USER_ID", "")


def _current_uid():
    """The uid alerts should be scoped to for THIS request (None on local build)."""
    if not context.multiuser():
        return None
    uid = context.user_id()
    if not uid or context.actor() == context.SERVICE_PRINCIPAL:
        return _OWNER_UID or None
    return uid


def raise_alert(kind="info", title="", body="", data=None, email=False, user_id=None):
    """Raise an alert. Connector/heartbeat callers pass no user_id → it goes to the admin
    (their world: mailroom, Estoppel, monitors). Request-context callers stamp that user."""
    uid = user_id if user_id is not None else _current_uid()
    if context.multiuser() and uid:
        aid = db.write(
            "INSERT INTO alerts (kind, title, body, data_json, user_id) VALUES (?, ?, ?, ?, ?)",
            (kind, title, body, json.dumps(data or {}, default=str), uid),
        )
    else:
        aid = db.write(
            "INSERT INTO alerts (kind, title, body, data_json) VALUES (?, ?, ?, ?)",
            (kind, title, body, json.dumps(data or {}, default=str)),
        )
    if email:
        try:
            from . import kernel as _k
            _k.execute_tool("email.send", {"subject": f"Veyra · {title}", "body": body,
                                           "purpose": "alert"}, actor="agent")
        except Exception:
            pass
    return aid


def unseen(limit=20):
    uid = _current_uid()
    if uid:
        rows = db.query("SELECT id, kind, title, body, data_json, created_at FROM alerts "
                        "WHERE seen = 0 AND user_id = ? ORDER BY id ASC LIMIT ?", (uid, limit))
    else:
        rows = db.query("SELECT id, kind, title, body, data_json, created_at FROM alerts "
                        "WHERE seen = 0 ORDER BY id ASC LIMIT ?", (limit,))
    for r in rows:
        try:
            r["data"] = json.loads(r.pop("data_json") or "{}")
        except Exception:
            r["data"] = {}
    return rows


def recent(limit=50):
    uid = _current_uid()
    if uid:
        return db.query("SELECT id, kind, title, body, seen, created_at FROM alerts "
                        "WHERE user_id = ? ORDER BY id DESC LIMIT ?", (uid, limit))
    return db.query("SELECT id, kind, title, body, seen, created_at FROM alerts "
                    "ORDER BY id DESC LIMIT ?", (limit,))


def mark_seen(aid):
    uid = _current_uid()
    if uid:
        db.write("UPDATE alerts SET seen = 1 WHERE id = ? AND user_id = ?", (aid, uid))
    else:
        db.write("UPDATE alerts SET seen = 1 WHERE id = ?", (aid,))


def mark_all_seen():
    uid = _current_uid()
    if uid:
        db.write("UPDATE alerts SET seen = 1 WHERE seen = 0 AND user_id = ?", (uid,))
    else:
        db.write("UPDATE alerts SET seen = 1 WHERE seen = 0", ())
