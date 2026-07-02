"""Verify filesystem tools run THROUGH the kernel (tiers enforced, ops reversible).

Run:  py backend/tests/test_tools.py
"""

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from veyra.kernel import paths  # noqa: E402

_tmp = Path(tempfile.mkdtemp(prefix="veyra_tools_"))
paths.VEYRA_HOME = _tmp / ".veyra"
paths.KERNEL_DB = paths.VEYRA_HOME / "kernel.db"
paths.TRASH_DIR = paths.VEYRA_HOME / "trash"

from veyra import kernel  # noqa: E402
from veyra.kernel import ApprovalRequired, approvals  # noqa: E402
from veyra.tools import fsutil, load_all  # noqa: E402

# Redirect the workspaces root to the temp dir for the test.
_ws = _tmp / "workspaces"
_ws.mkdir(parents=True)
fsutil.ROOTS["workspaces"] = _ws

PASS = 0


def ok(label):
    global PASS
    PASS += 1
    print(f"  [ok] {label}")


def run():
    kernel.boot()
    count = load_all()
    print(f"Tool layer smoke test ({count} tools registered)")
    assert count >= 6
    ok("filesystem tools registered against the kernel")

    # write (caution) runs automatically
    r = kernel.execute_tool("files.write", {"path": "notes/hello.txt", "content": "hi there"})
    assert r["ok"] and (_ws / "notes/hello.txt").exists()
    ok("files.write (caution) runs and creates the file")

    # read (safe)
    r = kernel.execute_tool("files.read", {"path": "notes/hello.txt"})
    assert r["content"] == "hi there"
    ok("files.read (safe) returns content")

    # list + search (safe)
    assert any(i["path"] == "notes/hello.txt" for i in kernel.execute_tool("files.list", {})["items"])
    assert kernel.execute_tool("files.search", {"query": "there"})["matches"]
    ok("files.list / files.search (safe) work")

    # path traversal is refused
    try:
        kernel.execute_tool("files.read", {"path": "../../../Windows/system.ini"})
        assert False
    except Exception as exc:
        assert "outside" in str(exc).lower()
    ok("path traversal is refused")

    # delete (danger) requires approval and does NOT delete yet
    try:
        kernel.execute_tool("files.delete", {"path": "notes/hello.txt"})
        assert False
    except ApprovalRequired as exc:
        aid = exc.approval_id
    assert (_ws / "notes/hello.txt").exists(), "file must survive until approved"
    ok("files.delete (danger) blocks on approval")

    # approve -> deletes, snapshot taken, restorable
    approvals.decide(aid, approved=True)
    out = kernel.execute_tool("files.delete", {"path": "notes/hello.txt"}, approval_id=aid)
    assert not (_ws / "notes/hello.txt").exists()
    assert out["snapshot_id"]
    ok("approved delete removes the file and records a snapshot")

    from veyra.kernel import snapshots
    assert snapshots.restore(out["snapshot_id"]) is True
    assert (_ws / "notes/hello.txt").read_text(encoding="utf-8") == "hi there"
    ok("deleted file is fully recoverable from the snapshot")

    print(f"\nAll {PASS} tool checks passed.")


if __name__ == "__main__":
    run()
