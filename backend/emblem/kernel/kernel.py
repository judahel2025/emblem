"""The kernel facade: the single entry point through which the agent runs tools.

execute_tool() is the choke point. No tool runs except through here, so every tier
check, approval, and audit entry is guaranteed. The agent never calls a tool handler
directly.

Enforcement order for a call:
  1. kill switch        -> KillSwitchActive
  2. unknown tool       -> UnknownTool
  3. forbidden + off    -> Forbidden
  4. local-only + net   -> LocalOnlyViolation
  5. danger tier:
        remembered?     -> proceed
        no approval id  -> open approval, ApprovalRequired
        approval bad    -> ApprovalRequired / ApprovalRejected
        approval good   -> consume, proceed
  6. run handler, audit result
  7. caution tier       -> audited as 'notify' for the UI toast feed
"""

from . import approvals, audit, config, db
from .errors import (ApprovalRejected, ApprovalRequired, Forbidden,
                     KillSwitchActive, LocalOnlyViolation)
from .permissions import REGISTRY, Tier


def boot() -> None:
    """Initialise kernel storage. Safe to call repeatedly."""
    db.init_db()
    # Shared Postgres is managed out-of-band — schema already live.
    # (store.init() was removed when emblem_pg moved to the scoped emblem_rw role.)


def execute_tool(name: str, args: dict | None = None, *, actor: str = "agent",
                 approval_id: int | None = None):
    args = args or {}
    spec = REGISTRY.get(name)  # raises UnknownTool

    if config.kill_switch_on():
        audit.record(actor, name, spec.tier.value, args, "blocked:killswitch")
        raise KillSwitchActive("Kill switch is engaged. Disable it in Settings to act.")

    if spec.tier is Tier.FORBIDDEN and not config.tool_enabled(name):
        audit.record(actor, name, spec.tier.value, args, "blocked:forbidden")
        raise Forbidden(f"'{name}' is forbidden. Enable it explicitly in Settings to use it.")

    if spec.network and config.local_only():
        audit.record(actor, name, spec.tier.value, args, "blocked:local_only")
        raise LocalOnlyViolation(f"'{name}' needs network access but local-only mode is on.")

    # Approval logic (three paths to auto_ok):
    #  1. User clicked "approve and remember" for this tool specifically.
    #  2. Actor is the scheduler — the owner configured that task; fully trusted.
    #  3. Full-auto mode + tool is in FULL_AUTO_ALLOW (allowlist, not blocklist —
    #     new DANGER tools are NOT auto-approved until explicitly listed there).
    if actor in ("scheduler", "cloud-scheduler"):
        auto_ok = True
    elif config.is_auto_approved(name):
        auto_ok = True
    elif config.auto_mode() and name in config.FULL_AUTO_ALLOW:
        auto_ok = True
    else:
        auto_ok = False

    if spec.tier is Tier.DANGER and not auto_ok:
        if approval_id is None:
            aid = approvals.create(
                name, args,
                summary=spec.summary_for(args),
                target=spec.target_for(args),
                risk=spec.risk,
                requested_by=actor,
            )
            audit.record(actor, name, spec.tier.value, args, "pending_approval", approval_id=aid)
            raise ApprovalRequired(aid, spec.summary_for(args))

        row = approvals.get(approval_id)
        if row and row["status"] == "rejected":
            audit.record(actor, name, spec.tier.value, args, "rejected", approval_id=approval_id)
            raise ApprovalRejected(approval_id)
        if not approvals.is_satisfied(approval_id, name, args):
            raise ApprovalRequired(approval_id, spec.summary_for(args))
        approvals.consume(approval_id)

    try:
        result = spec.handler(**args)
    except Exception as exc:
        audit.record(actor, name, spec.tier.value, args, "error", result=str(exc),
                     approval_id=approval_id)
        raise

    status = "notify" if spec.tier is Tier.CAUTION else "ok"
    audit.record(actor, name, spec.tier.value, args, status,
                 result=_summarize_result(result), approval_id=approval_id)
    return result


def resolve_approval(approval_id: int, approved: bool, decided_by: str = "user", note: str = ""):
    """Decide a pending approval AND, when approved, actually run the bound action.

    This is what makes "approve" (a button click OR a spoken "go ahead") perform the work,
    instead of just flipping a flag. Single-use: the approval is consumed by execute_tool.
    """
    import json as _json
    ok = approvals.decide(approval_id, approved, decided_by=decided_by, note=note)
    if not ok:
        return {"ok": False, "error": "No pending approval with that id."}
    if not approved:
        return {"ok": True, "approved": False, "approval_id": approval_id}
    row = approvals.get(approval_id)
    if not row:
        return {"ok": False, "error": "Approval vanished."}
    try:
        args = _json.loads(row["args_json"] or "{}")
    except Exception:
        args = {}
    try:
        result = execute_tool(row["tool"], args, actor=decided_by, approval_id=approval_id)
        return {"ok": True, "approved": True, "approval_id": approval_id, "result": result}
    except Exception as exc:
        return {"ok": False, "approved": True, "approval_id": approval_id, "error": str(exc)}


def _summarize_result(result) -> str:
    if result is None:
        return ""
    text = result if isinstance(result, str) else repr(result)
    return text[:500]


def status() -> dict:
    """Kernel health for the UI."""
    return {
        "tools": len(REGISTRY.all()),
        "gated_tools": sum(1 for s in REGISTRY.all() if s.tier in (Tier.DANGER, Tier.FORBIDDEN)),
        "pending_approvals": len(approvals.pending()),
        "flags": config.snapshot(),
    }
