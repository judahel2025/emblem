"""Kernel control-flow exceptions.

These are not bugs -- they are how the kernel says "no" or "not yet" to the agent.
"""


class KernelError(Exception):
    """Base for all kernel refusals."""


class ApprovalRequired(KernelError):
    """A danger-tier tool was called without an approved decision.

    Carries the approval id the UI must resolve. The agent should pause, surface the
    approval to the user, and retry the same call with approval_id once approved.
    """

    def __init__(self, approval_id: int, summary: str = ""):
        self.approval_id = approval_id
        self.summary = summary
        super().__init__(f"Approval required (#{approval_id}): {summary}")


class ApprovalRejected(KernelError):
    def __init__(self, approval_id: int):
        self.approval_id = approval_id
        super().__init__(f"Approval #{approval_id} was rejected by the user.")


class KillSwitchActive(KernelError):
    """Global stop is engaged; no tool may run."""


class Forbidden(KernelError):
    """Tool is forbidden-tier and not explicitly enabled in settings."""


class LocalOnlyViolation(KernelError):
    """Local-only mode is on and the tool needs network/egress."""


class UnknownTool(KernelError):
    pass
