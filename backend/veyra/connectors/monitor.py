"""Proactive monitor — Veyra watches Master Judah's products and surfaces real changes.

Runs on a schedule (see scheduler). Each check snapshots the key product metrics, compares
them to the previous snapshot, and on a meaningful change (new signups, a notable jump/drop in
revenue or traffic, new users) raises an alert by emailing the owner and recording it. Quiet
when nothing important changed, so it never spams.
"""

import json

from ..kernel import Tier, tool, config
from .. import kernel as _kernel

_SNAP_KEY = "monitor_last_snapshot"
_NOTABLE_PCT = 20.0   # treat a >=20% move as worth flagging


def _last():
    try:
        return json.loads(config.get(_SNAP_KEY, "") or "{}")
    except Exception:
        return {}


def _flatten(report):
    """Pull a flat {metric: current} snapshot out of the analytics report."""
    snap = {}
    for product in ("estoppel", "quaniac"):
        block = (report or {}).get(product) or {}
        for k, v in (block.get("metrics") or {}).items():
            if isinstance(v, dict) and "current" in v:
                snap[f"{product}.{k}"] = v.get("current")
    return snap


@tool("monitor.check", Tier.SAFE,
      "Check products for meaningful changes since last check; alert the owner if notable",
      network=True)
def check(period="day"):
    try:
        report = _kernel.execute_tool("analytics.report", {"period": period}, actor="agent")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    snap = _flatten(report)
    prev = _last()
    notable = []
    for metric, cur in snap.items():
        if cur is None:
            continue
        old = prev.get(metric)
        if old is None:
            continue  # first run for this metric — set baseline, don't alert
        try:
            if old == 0 and cur > 0:
                notable.append(f"{metric}: 0 → {cur}")
            elif old and abs((cur - old) / old) * 100 >= _NOTABLE_PCT and cur != old:
                pct = round((cur - old) / old * 100, 1)
                notable.append(f"{metric}: {old} → {cur} ({'+' if pct > 0 else ''}{pct}%)")
        except Exception:
            pass

    # always refresh the baseline
    config.set(_SNAP_KEY, json.dumps(snap))

    if not notable:
        return {"ok": True, "changed": False, "snapshot": snap}

    summary = "Veyra noticed changes on your products:\n\n- " + "\n- ".join(notable)
    try:
        _kernel.execute_tool("email.send", {"subject": "Veyra · product update",
                "body": summary, "purpose": "alert"}, actor="agent")
    except Exception:
        pass
    try:
        _kernel.execute_tool("memory.save", {"content": summary, "kind": "alert"}, actor="agent")
    except Exception:
        pass
    return {"ok": True, "changed": True, "notable": notable, "snapshot": snap}
