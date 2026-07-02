"""End-to-end smoke test for the Security Kernel.

Run:  py backend/tests/test_kernel.py
No test framework needed -- plain asserts. Uses a throwaway kernel db so it never
touches real runtime state.
"""

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Point the kernel at a temporary db BEFORE importing anything that opens it.
from emblem.kernel import paths  # noqa: E402

_tmp = Path(tempfile.mkdtemp(prefix="emblem_test_"))
paths.EMBLEM_HOME = _tmp
paths.KERNEL_DB = _tmp / "kernel.db"
paths.TRASH_DIR = _tmp / "trash"

from emblem import kernel  # noqa: E402
from emblem.kernel import (ApprovalRequired, Forbidden, KillSwitchActive, Tier,  # noqa: E402
                          approvals, audit, config, snapshots, tool, vault)

PASS = 0


def ok(label):
    global PASS
    PASS += 1
    print(f"  [ok] {label}")


# --- register some tools at each tier --------------------------------------------
@tool("test.echo", Tier.SAFE, "Echo text back")
def _echo(text=""):
    return f"echo:{text}"


@tool("test.search", Tier.CAUTION, "Pretend web search", network=True)
def _search(q=""):
    return f"results for {q}"


_sent = []


@tool("test.send_email", Tier.DANGER, "Send an email",
      summarize=lambda a: f"Send email to {a.get('to')}",
      target=lambda a: a.get("to", ""))
def _send(to="", body=""):
    _sent.append((to, body))
    return f"sent to {to}"


@tool("test.format_disk", Tier.FORBIDDEN, "Dangerous forbidden op")
def _format():
    return "formatted"


def run():
    kernel.boot()
    print("Security Kernel smoke test")

    # 1. SAFE runs automatically
    assert kernel.execute_tool("test.echo", {"text": "hi"}) == "echo:hi"
    ok("safe tool runs without approval")

    # 2. CAUTION runs but is audited as a notify
    assert kernel.execute_tool("test.search", {"q": "emblem"}) == "results for emblem"
    assert audit.tail(1)[0]["status"] == "notify"
    ok("caution tool runs and is flagged for notification")

    # 3. DANGER pauses with ApprovalRequired and does NOT run
    try:
        kernel.execute_tool("test.send_email", {"to": "a@b.com", "body": "hello"})
        assert False, "danger tool should have required approval"
    except ApprovalRequired as exc:
        approval_id = exc.approval_id
    assert _sent == [], "email must not send before approval"
    assert len(approvals.pending()) == 1
    ok("danger tool blocks and opens an approval")

    # 4. Wrong/unapproved id keeps it blocked
    try:
        kernel.execute_tool("test.send_email", {"to": "a@b.com", "body": "hello"},
                            approval_id=approval_id)
        assert False
    except ApprovalRequired:
        pass
    ok("pending approval still blocks execution")

    # 5. Approve, then the SAME call proceeds
    assert approvals.decide(approval_id, approved=True) is True
    assert kernel.execute_tool("test.send_email", {"to": "a@b.com", "body": "hello"},
                               approval_id=approval_id) == "sent to a@b.com"
    assert _sent == [("a@b.com", "hello")]
    ok("approved danger tool runs exactly once")

    # 6. Approval is single-use (consumed) -- cannot replay
    try:
        kernel.execute_tool("test.send_email", {"to": "a@b.com", "body": "hello"},
                            approval_id=approval_id)
        assert False
    except ApprovalRequired:
        pass
    ok("approval cannot be replayed")

    # 7. Approval is bound to args -- approved A cannot send B
    aid2 = None
    try:
        kernel.execute_tool("test.send_email", {"to": "a@b.com", "body": "v2"})
    except ApprovalRequired as exc:
        aid2 = exc.approval_id
    approvals.decide(aid2, approved=True)
    try:
        kernel.execute_tool("test.send_email", {"to": "EVIL@x.com", "body": "v2"},
                            approval_id=aid2)
        assert False, "tampered args must not satisfy the approval"
    except ApprovalRequired:
        pass
    ok("approval is bound to exact arguments")

    # 8. FORBIDDEN blocked until explicitly enabled
    try:
        kernel.execute_tool("test.format_disk")
        assert False
    except Forbidden:
        pass
    config.set_tool_enabled("test.format_disk", True)
    assert kernel.execute_tool("test.format_disk") == "formatted"
    ok("forbidden tool blocked until enabled in settings")

    # 9. Kill switch stops everything
    config.set_kill_switch(True)
    try:
        kernel.execute_tool("test.echo", {"text": "x"})
        assert False
    except KillSwitchActive:
        pass
    config.set_kill_switch(False)
    ok("kill switch halts all tool execution")

    # 10. Local-only blocks network tools
    config.set_local_only(True)
    try:
        kernel.execute_tool("test.search", {"q": "x"})
        assert False
    except Exception as exc:
        assert "local-only" in str(exc).lower()
    config.set_local_only(False)
    ok("local-only mode blocks network tools")

    # 11. Vault round-trips and never leaks the value in listings
    vault.set_secret("flutterwave_secret", "FLWSECK-supersecret")
    assert vault.get_secret("flutterwave_secret") == "FLWSECK-supersecret"
    listing = vault.list_secrets()
    assert listing and "value" not in listing[0] and "value_blob" not in listing[0]
    print(f"  [info] DPAPI protection active: {vault.dpapi_available()}")
    ok("vault encrypts, retrieves, and never lists secret values")

    # 12. Snapshot + restore makes file ops reversible
    f = _tmp / "doc.txt"
    f.write_text("original", encoding="utf-8")
    snap = snapshots.snapshot(f, reason="test overwrite")
    f.write_text("destroyed", encoding="utf-8")
    assert snapshots.restore(snap) is True
    assert f.read_text(encoding="utf-8") == "original"
    ok("snapshot + restore reverses a destructive write")

    # 13. Audit captured the journey and redacted nothing sensitive in args
    trail = audit.tail(50)
    assert any(r["tool"] == "test.send_email" and r["status"] == "ok" for r in trail)
    print(f"  [info] audit rows recorded: {len(trail)}")
    ok("audit log captured the full sequence")

    print(f"\nAll {PASS} kernel checks passed.")


if __name__ == "__main__":
    run()
