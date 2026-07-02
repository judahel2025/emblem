"""Flutterwave connector — read-only payment intelligence.

Uses the secret key stored in the vault (name: flutterwave_secret). Returns configured=False
(not an error) when no key is set, so the UI can show a "connect" prompt instead of data.
No money movement here — refunds/payouts would be separate danger-tier tools.
"""

from datetime import datetime, timedelta, timezone

import httpx

from ..kernel import Tier, tool, vault

BASE = "https://api.flutterwave.com/v3"


def _key():
    return vault.get_secret("flutterwave_secret")


def _parse(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


@tool("flutterwave.stats", Tier.SAFE, "Flutterwave revenue & payment stats", network=True)
def stats():
    key = _key()
    if not key:
        return {"ok": False, "configured": False,
                "error": "No Flutterwave key yet. Add it in Settings → Connectors."}
    try:
        with httpx.Client(timeout=20, headers={"Authorization": f"Bearer {key}"}) as c:
            r = c.get(f"{BASE}/transactions", params={"status": "successful"})
            body = r.json()
        txs = body.get("data") or []
        now = datetime.now(timezone.utc)
        day0 = now - timedelta(days=1)
        week0 = now - timedelta(days=7)
        month0 = now - timedelta(days=30)
        today = week = month = 0.0
        success = fail = 0
        recent = []
        for t in txs:
            amt = float(t.get("amount") or 0)
            st = (t.get("status") or "").lower()
            if st == "successful":
                success += 1
            else:
                fail += 1
            dt = _parse(t.get("created_at", ""))
            if dt:
                if dt >= day0: today += amt
                if dt >= week0: week += amt
                if dt >= month0: month += amt
            if len(recent) < 8:
                cust = (t.get("customer") or {})
                recent.append({"name": cust.get("name") or cust.get("email") or "Customer",
                               "amount": amt, "currency": t.get("currency", ""), "status": st})
        cur = (txs[0].get("currency") if txs else "") or ""
        return {"ok": True, "configured": True, "currency": cur,
                "today": round(today, 2), "week": round(week, 2), "month": round(month, 2),
                "successful": success, "failed": fail, "recent": recent}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("flutterwave.transactions", Tier.SAFE, "List recent Flutterwave transactions", network=True)
def transactions(limit=20):
    key = _key()
    if not key:
        return {"ok": False, "configured": False}
    try:
        with httpx.Client(timeout=20, headers={"Authorization": f"Bearer {key}"}) as c:
            body = c.get(f"{BASE}/transactions").json()
        return {"ok": True, "configured": True, "items": (body.get("data") or [])[:limit]}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}
