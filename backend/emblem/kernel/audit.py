"""Append-only audit log.

Every tool the kernel runs (or refuses) leaves a row here. Args are redacted before
storage. The log is never updated or deleted by the kernel -- only appended and read.
"""

import json

from . import db
from .permissions import redact


def record(actor: str, tool: str, tier: str, args: dict, status: str,
           result: str = "", approval_id=None) -> int:
    return db.write(
        """INSERT INTO kernel_audit (actor, tool, tier, args_json, status, result, approval_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (actor, tool, tier, json.dumps(redact(args)), status, (result or "")[:2000], approval_id),
    )


def tail(limit: int = 100):
    return db.query(
        """SELECT id, actor, tool, tier, args_json, status, result, approval_id, created_at
           FROM kernel_audit ORDER BY id DESC LIMIT ?""",
        (limit,),
    )


def for_tool(tool: str, limit: int = 50):
    return db.query(
        """SELECT id, actor, tool, tier, status, result, created_at
           FROM kernel_audit WHERE tool = ? ORDER BY id DESC LIMIT ?""",
        (tool, limit),
    )
