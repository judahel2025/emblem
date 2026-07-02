"""Startup briefing — what Veyra greets Master Judah with when she comes on.

Reads the watcher's event feed (Veyra cloud) for recent activity + quick counts, and
builds a greeting + a short spoken summary. Fast (a couple of queries) so startup is snappy.
"""

from datetime import datetime, timezone

from ..kernel import Tier, tool, vault


def _greeting():
    h = datetime.now().hour
    part = "morning" if h < 12 else ("afternoon" if h < 18 else "evening")
    return f"Good {part}, Master Judah."


def _phrase(counts):
    # turn {kind: n} into "3 new signups, 1 payment"
    label = {"signup": ("new signup", "new signups"), "payment": ("payment", "payments"),
             "contact": ("new message", "new messages"), "anomaly": ("anomaly", "anomalies"),
             "uptime": ("uptime alert", "uptime alerts")}
    parts = []
    for k, n in sorted(counts.items(), key=lambda x: -x[1]):
        if n <= 0:
            continue
        sing, plur = label.get(k, (k, k + "s"))
        parts.append(f"{n} {sing if n == 1 else plur}")
    return ", ".join(parts)


@tool("briefing.get", Tier.SAFE, "Veyra startup briefing: greeting, recent alerts and quick counts", network=True)
def get():
    out = {"ok": True, "greeting": _greeting(), "recent": [], "counts_24h": {}, "counts_7d": {}, "summary": ""}
    cs = vault.get_secret("veyra_pg")
    if not cs:
        out["summary"] = "I'm online and ready."
        return out
    try:
        import psycopg
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            c = conn.cursor()
            c.execute("select kind, count(*) from public.events where occurred_at >= now() - interval '24 hours' group by 1")
            out["counts_24h"] = {k: n for k, n in c.fetchall()}
            c.execute("select kind, count(*) from public.events where occurred_at >= now() - interval '7 days' group by 1")
            out["counts_7d"] = {k: n for k, n in c.fetchall()}
            c.execute("select product, kind, severity, title, occurred_at from public.events order by occurred_at desc limit 8")
            out["recent"] = [{"product": p, "kind": k, "severity": s, "title": t, "occurred_at": o.isoformat()}
                             for p, k, s, t, o in c.fetchall()]
        day = _phrase(out["counts_24h"])
        week = _phrase(out["counts_7d"])
        if day:
            out["summary"] = f"In the last 24 hours: {day}."
        elif week:
            out["summary"] = f"Quiet today. This week: {week}."
        else:
            out["summary"] = "All quiet across your products. Everything's running."
    except Exception as exc:
        out["summary"] = "I'm online. (Couldn't reach the activity feed just now.)"
        out["error"] = str(exc)[:120]
    return out
