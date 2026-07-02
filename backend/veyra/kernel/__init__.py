"""Veyra Security Kernel -- the foundation every capability plugs into.

Public surface:
    from veyra.kernel import boot, execute_tool, tool, Tier
    from veyra.kernel import approvals, audit, config, vault, snapshots

The kernel is pure standard library (sqlite3, ctypes/DPAPI, hashlib) so it runs on the
machine's installed Python with no install step.
"""

from . import approvals, audit, config, snapshots, vault
from .errors import (ApprovalRejected, ApprovalRequired, Forbidden, KernelError,
                     KillSwitchActive, LocalOnlyViolation, UnknownTool)
from .kernel import boot, execute_tool, resolve_approval, status
from .permissions import REGISTRY, Tier, ToolSpec, tool

__all__ = [
    "boot", "execute_tool", "resolve_approval", "status",
    "tool", "Tier", "ToolSpec", "REGISTRY",
    "approvals", "audit", "config", "vault", "snapshots",
    "KernelError", "ApprovalRequired", "ApprovalRejected", "KillSwitchActive",
    "Forbidden", "LocalOnlyViolation", "UnknownTool",
]
