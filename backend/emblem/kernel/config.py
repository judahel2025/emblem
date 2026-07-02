"""Kernel configuration flags: kill switch, local-only mode, forbidden-tool toggles,
and 'approve and remember' decisions.

All stored as simple key/value rows so the UI settings screen maps onto them directly.
"""

from . import db

KILL_SWITCH = "kill_switch"
LOCAL_ONLY = "local_only"
APPROVAL_MODE = "approval_mode"       # "ask" (confirm) | "auto" (full-auto for the owner)
_ENABLE_PREFIX = "enable_tool:"       # forbidden-tier tool explicitly turned on
_AUTOAPPROVE_PREFIX = "auto_approve:"  # danger-tier tool the user chose to remember

# Explicit allowlist for full-auto mode — new DANGER tools are NOT auto-approved until
# listed here. This is an allowlist, not a blocklist: omission = requires a click.
FULL_AUTO_ALLOW = frozenset({
    "email.send_to",           # one-off emails the user dictates
    "files.delete",            # explicit file deletion
})

# Kept for reference — use FULL_AUTO_ALLOW for new logic.
DESTRUCTIVE_TOOLS = frozenset()


def get(key: str, default: str = "") -> str:
    row = db.one("SELECT value FROM kernel_config WHERE key = ?", (key,))
    return row["value"] if row else default


def set(key: str, value: str) -> None:
    db.write(
        """INSERT INTO kernel_config (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
        (key, value),
    )


def _flag(key: str, default=False) -> bool:
    return get(key, "1" if default else "0") == "1"


def _set_flag(key: str, on: bool) -> None:
    set(key, "1" if on else "0")


# --- kill switch -----------------------------------------------------------------
def kill_switch_on() -> bool:
    return _flag(KILL_SWITCH)


def set_kill_switch(on: bool) -> None:
    _set_flag(KILL_SWITCH, on)


# --- local-only mode -------------------------------------------------------------
def local_only() -> bool:
    return _flag(LOCAL_ONLY)


def set_local_only(on: bool) -> None:
    _set_flag(LOCAL_ONLY, on)


# --- approval mode (ask vs full-auto) --------------------------------------------
def approval_mode() -> str:
    return get(APPROVAL_MODE, "ask") or "ask"


def set_approval_mode(mode: str) -> None:
    set(APPROVAL_MODE, "auto" if mode == "auto" else "ask")


def auto_mode() -> bool:
    return approval_mode() == "auto"


# --- forbidden-tier enablement ---------------------------------------------------
def tool_enabled(name: str) -> bool:
    return _flag(_ENABLE_PREFIX + name)


def set_tool_enabled(name: str, on: bool) -> None:
    _set_flag(_ENABLE_PREFIX + name, on)


# --- remembered approvals --------------------------------------------------------
def is_auto_approved(name: str) -> bool:
    return _flag(_AUTOAPPROVE_PREFIX + name)


def set_auto_approved(name: str, on: bool) -> None:
    _set_flag(_AUTOAPPROVE_PREFIX + name, on)


def snapshot() -> dict:
    """Current flags, for the settings screen."""
    return {
        "kill_switch": kill_switch_on(),
        "local_only": local_only(),
        "approval_mode": approval_mode(),
        "enabled_tools": [
            r["key"][len(_ENABLE_PREFIX):]
            for r in db.query("SELECT key FROM kernel_config WHERE key LIKE ? AND value = '1'",
                              (_ENABLE_PREFIX + "%",))
        ],
        "remembered_approvals": [
            r["key"][len(_AUTOAPPROVE_PREFIX):]
            for r in db.query("SELECT key FROM kernel_config WHERE key LIKE ? AND value = '1'",
                              (_AUTOAPPROVE_PREFIX + "%",))
        ],
    }
