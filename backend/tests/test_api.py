"""API smoke test via Starlette TestClient (no live port needed).

Run:  C:\\EMBLEM\\.venv\\Scripts\\python.exe backend\\tests\\test_api.py
"""

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from emblem.kernel import paths  # noqa: E402

_tmp = Path(tempfile.mkdtemp(prefix="emblem_api_"))
paths.EMBLEM_HOME = _tmp / ".emblem"
paths.KERNEL_DB = paths.EMBLEM_HOME / "kernel.db"
paths.TRASH_DIR = paths.EMBLEM_HOME / "trash"
_ws = _tmp / "workspaces"
_ws.mkdir(parents=True)
paths.WORKSPACES_DIR = _ws

from fastapi.testclient import TestClient  # noqa: E402

from emblem.api.app import app  # noqa: E402
from emblem.tools import fsutil  # noqa: E402

fsutil.ROOTS["workspaces"] = _ws

PASS = 0


def ok(label):
    global PASS
    PASS += 1
    print(f"  [ok] {label}")


def run():
    print("API smoke test")
    with TestClient(app) as client:
        h = client.get("/api/health").json()
        assert h["status"] == "online" and "kernel" in h and "brain" in h
        ok(f"/api/health online ({h['kernel']['tools']} tools, brain={h['brain']['provider']})")

        tools = client.get("/api/tools").json()["tools"]
        assert any(t["name"] == "files.delete" and t["tier"] == "danger" for t in tools)
        ok("/api/tools lists tiers (files.delete = danger)")

        r = client.post("/api/tools/execute",
                        json={"name": "files.write",
                              "args": {"path": "a.txt", "content": "hello api"}}).json()
        assert r["ok"] and (_ws / "a.txt").exists()
        ok("execute files.write (caution) succeeds via API")

        r = client.post("/api/tools/execute",
                        json={"name": "files.delete", "args": {"path": "a.txt"}}).json()
        assert r.get("approval_required") and not r["ok"]
        aid = r["approval_id"]
        assert (_ws / "a.txt").exists(), "file must survive until approved"
        ok("execute files.delete (danger) returns approval_required")

        pend = client.get("/api/approvals").json()["pending"]
        assert any(p["id"] == aid for p in pend)
        ok("pending approval visible at /api/approvals")

        d = client.post(f"/api/approvals/{aid}/decide", json={"approved": True}).json()
        assert d["ok"] and not (_ws / "a.txt").exists(), "approving runs the action immediately"
        snap_id = d["result"]["snapshot_id"]
        ok("approve (button/voice) runs the bound action and snapshots the file")

        assert client.post(f"/api/snapshots/{snap_id}/restore").json()["ok"]
        assert (_ws / "a.txt").exists()
        ok("snapshot restore brings the file back via API")

        client.post("/api/config/kill-switch", json={"on": True})
        r = client.post("/api/tools/execute",
                        json={"name": "files.write", "args": {"path": "b.txt", "content": "x"}}).json()
        assert not r["ok"] and "kill" in r["error"].lower()
        client.post("/api/config/kill-switch", json={"on": False})
        ok("kill switch (via API) halts tool execution")

        client.post("/api/secrets", json={"name": "test_key", "value": "SECRET123"})
        secs = client.get("/api/secrets").json()
        assert any(s["name"] == "test_key" for s in secs["items"])
        assert "SECRET123" not in client.get("/api/secrets").text
        ok("secret stored; value never returned by the API")

        # --- code persistence ---------------------------------------------------
        client.post("/api/code", json={"path": "demo/hello.py", "content": "print('hi')", "language": "python"})
        got = client.get("/api/code/get?path=demo/hello.py").json()
        assert got["ok"] and got["content"] == "print('hi')"
        assert any(i["path"] == "demo/hello.py" for i in client.get("/api/code").json()["items"])
        ok("code auto-save persists and is retrievable")

        # --- email archive / delete --------------------------------------------
        from emblem.tools import emails as _em
        eid = _em.add_draft("x@y.com", "Hi", "Body")["id"]
        client.post(f"/api/emails/{eid}/archive")
        assert any(d["id"] == eid for d in client.get("/api/emails?status=archived").json()["items"])
        client.delete(f"/api/emails/{eid}")
        assert not any(d["id"] == eid for d in client.get("/api/emails").json()["items"])
        ok("email archive + delete update the inbox")

        # --- approval mode (full-auto runs non-destructive danger) -------------
        client.post("/api/config/approval-mode", json={"mode": "auto"})
        assert client.get("/api/config").json()["approval_mode"] == "auto"
        client.post("/api/config/approval-mode", json={"mode": "ask"})
        ok("approval mode toggles ask <-> auto")

        # --- scheduler: create a due task and tick it --------------------------
        from emblem.tools import schedule as _sch
        from emblem import scheduler as _scheduler
        tid = _sch.create(title="t", tool="files.write",
                          args={"path": "sched.txt", "content": "fired"}, every="day", count=1)["id"]
        _scheduler._tick_local()
        assert (_ws / "sched.txt").exists() and (_ws / "sched.txt").read_text() == "fired"
        done = [t for t in client.get("/api/schedule").json()["items"] if t["id"] == tid][0]
        assert done["runs_done"] == 1 and done["status"] == "done"
        ok("scheduler fires a due task and marks it done")

        # --- alerts feed (Emblem comes alive) -----------------------------------
        from emblem import alerts as _al
        aid = _al.raise_alert(kind="support", title="New support message", body="Hi there")
        un = client.get("/api/alerts").json()["items"]
        assert any(x["id"] == aid for x in un)
        client.post(f"/api/alerts/{aid}/seen")
        assert not any(x["id"] == aid for x in client.get("/api/alerts").json()["items"])
        ok("alerts raise, surface as unseen, and clear when seen")

        # --- estoppel email tools registered -----------------------------------
        names = {t["name"] for t in client.get("/api/tools").json()["tools"]}
        assert {"estoppel.send_mail", "estoppel.newsletter", "estoppel.support_inbox",
                "estoppel.support_reply", "estoppel.activity_check"} <= names
        ok("Estoppel email + support tools are registered")

    print(f"\nAll {PASS} API checks passed.")


if __name__ == "__main__":
    run()
