"""Self-improvement log — when Veyra hits a limit or spots something she should do better,
she records it here so Master Judah can see exactly what to teach or upgrade in her.
"""

from ..kernel import Tier, tool
from ..kernel import data as db   # shared store when configured; local SQLite otherwise


@tool("improve.log", Tier.SAFE, "Log something Veyra needs improved / Master Judah should teach her",
      summarize=lambda a: f"Improvement: {str(a.get('area', ''))[:50]}")
def log(area="", detail=""):
    if not (detail or area):
        return {"ok": False, "error": "Nothing to log."}
    iid = db.write("INSERT INTO improvements (area, detail) VALUES (?, ?)", (area or "", detail or ""))
    return {"ok": True, "id": iid}


@tool("improve.list", Tier.SAFE, "List logged improvement requests")
def listing(status="open"):
    if status and status != "all":
        return {"ok": True, "items": db.query(
            "SELECT id, area, detail, status, created_at FROM improvements WHERE status = ? "
            "ORDER BY id DESC LIMIT 200", (status,))}
    return {"ok": True, "items": db.query(
        "SELECT id, area, detail, status, created_at FROM improvements ORDER BY id DESC LIMIT 200")}


@tool("improve.resolve", Tier.SAFE, "Mark an improvement as done")
def resolve(id=0):
    db.write("UPDATE improvements SET status='done' WHERE id = ?", (id,))
    return {"ok": True, "id": id}
