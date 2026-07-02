"""The Approval Gate.

When a danger-tier tool is called, the kernel opens an approval here and pauses. The UI
shows the exact action; the user approves or rejects; the agent retries the call with the
approval id once it is approved.

An approval is single-use: it is bound to a tool + a hash of its arguments, so an approved
"send email to A" cannot be reused to send a different email.
"""

import hashlib
import json

from . import context, db


def _arg_hash(tool: str, args: dict) -> str:
    blob = tool + "\x00" + json.dumps(args or {}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _scope_uid():
    """uid to filter approval reads by — None for owner/admin/local (sees all)."""
    if not context.multiuser() or context.is_owner():
        return None
    return context.user_id()


def create(tool: str, args: dict, *, summary: str, target: str = "", risk: str = "high",
           requested_by: str = "agent") -> int:
    """Open a pending approval, stamped with the requesting user. The args hash is
    stored in the note for binding checks."""
    uid = context.user_id() if context.multiuser() else None
    if uid:
        return db.write(
            """INSERT INTO kernel_approvals (tool, summary, target, args_json, risk, requested_by, note, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (tool, summary, target, json.dumps(args or {}, default=str), risk, requested_by,
             _arg_hash(tool, args), uid),
        )
    return db.write(
        """INSERT INTO kernel_approvals (tool, summary, target, args_json, risk, requested_by, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (tool, summary, target, json.dumps(args or {}, default=str), risk, requested_by,
         _arg_hash(tool, args)),
    )


def get(approval_id: int):
    return db.one("SELECT * FROM kernel_approvals WHERE id = ?", (approval_id,))


def owned_by_current(row) -> bool:
    """May the current requester act on this approval? Owner/admin: always."""
    uid = _scope_uid()
    return uid is None or (row or {}).get("user_id") == uid


def pending(limit: int = 100):
    uid = _scope_uid()
    if uid:
        return db.query(
            """SELECT id, tool, summary, target, risk, status, requested_by, created_at
               FROM kernel_approvals WHERE status = 'pending' AND user_id = ?
               ORDER BY id DESC LIMIT ?""",
            (uid, limit),
        )
    return db.query(
        """SELECT id, tool, summary, target, risk, status, requested_by, created_at
           FROM kernel_approvals WHERE status = 'pending' ORDER BY id DESC LIMIT ?""",
        (limit,),
    )


def by_tool(tool_prefix: str = "", status: str = "pending", limit: int = 100):
    """List approvals filtered by tool name prefix and/or status (scoped per user)."""
    limit = max(1, min(int(limit or 100), 500))
    base = ("SELECT id, tool, summary, target, risk, status, requested_by, created_at "
            "FROM kernel_approvals")
    where, params = [], []
    if status and status != "all":
        where.append("status = ?"); params.append(status)
    if tool_prefix:
        where.append("tool LIKE ?"); params.append(f"{tool_prefix}%")
    uid = _scope_uid()
    if uid:
        where.append("user_id = ?"); params.append(uid)
    sql = base + ((" WHERE " + " AND ".join(where)) if where else "") + " ORDER BY id DESC LIMIT ?"
    return db.query(sql, (*params, limit))


def recent(limit: int = 100):
    uid = _scope_uid()
    if uid:
        return db.query(
            """SELECT id, tool, summary, target, risk, status, requested_by, decided_by,
                      created_at, decided_at
               FROM kernel_approvals WHERE user_id = ? ORDER BY id DESC LIMIT ?""",
            (uid, limit),
        )
    return db.query(
        """SELECT id, tool, summary, target, risk, status, requested_by, decided_by,
                  created_at, decided_at
           FROM kernel_approvals ORDER BY id DESC LIMIT ?""",
        (limit,),
    )


def decide(approval_id: int, approved: bool, decided_by: str = "user", note: str = "") -> bool:
    # Users may only decide their own approvals; owner/admin may decide any.
    row = get(approval_id)
    if not row or not owned_by_current(row):
        return False
    status = "approved" if approved else "rejected"
    db.write(
        """UPDATE kernel_approvals
           SET status = ?, decided_by = ?, decided_at = datetime('now'), note = COALESCE(?, note)
           WHERE id = ? AND status = 'pending'""",
        (status, decided_by, note or None, approval_id),
    )
    after = get(approval_id)
    return bool(after and after["status"] == status)


def is_satisfied(approval_id: int, tool: str, args: dict) -> bool:
    """True only if this approval is approved AND bound to this exact tool+args."""
    row = get(approval_id)
    if not row or row["status"] != "approved" or row["tool"] != tool:
        return False
    return row["note"] == _arg_hash(tool, args)


def consume(approval_id: int) -> None:
    """Mark an approved request as used so it cannot run twice."""
    db.write(
        "UPDATE kernel_approvals SET status = 'consumed' WHERE id = ? AND status = 'approved'",
        (approval_id,),
    )
