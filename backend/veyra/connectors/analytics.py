"""Analytics engine — period-over-period statistics across Master Judah's products.

Computes the current window vs the previous window of equal length, with percentage
change (increase/decrease), breakdowns, and AI prompt/usage stats. Powers the weekly
report, the Analytics page, and any analytics question Veyra is asked.
"""

from datetime import datetime, timedelta, timezone

from ..kernel import Tier, tool, vault


def _delta(cur, prev):
    cur = cur or 0
    prev = prev or 0
    if prev == 0:
        return {"current": cur, "previous": prev, "change_pct": None,
                "direction": "up" if cur > 0 else "flat", "is_new": cur > 0}
    pct = round((cur - prev) / prev * 100, 1)
    return {"current": cur, "previous": prev, "change_pct": pct,
            "direction": "up" if pct > 0 else ("down" if pct < 0 else "flat"), "is_new": False}


def _windows(period):
    now = datetime.now(timezone.utc)
    days = 30 if period == "month" else (1 if period == "day" else 7)
    return now, now - timedelta(days=days), now - timedelta(days=2 * days), days


def _estoppel(period):
    cs = vault.get_secret("estoppel_pg_ro")
    if not cs:
        return {"configured": False}
    import psycopg
    now, cur_start, prev_start, _ = _windows(period)
    out = {"configured": True, "metrics": {}, "breakdowns": {}}
    try:
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            c = conn.cursor()

            def cnt(table, col, start, end, extra=""):
                c.execute(f"select count(*) from {table} where {col} >= %s and {col} < %s {extra}", (start, end))
                return c.fetchone()[0]

            out["metrics"]["signups"] = _delta(cnt("veyra_safe.users", "date_joined", cur_start, now),
                                                cnt("veyra_safe.users", "date_joined", prev_start, cur_start))
            c.execute("select count(*) from veyra_safe.users")
            out["metrics"]["total_users"] = {"current": c.fetchone()[0]}

            try:
                out["metrics"]["prompts"] = _delta(cnt("veyra_safe.usage_events", "created_at", cur_start, now),
                                                   cnt("veyra_safe.usage_events", "created_at", prev_start, cur_start))
                c.execute("select coalesce(sum(credits),0) from veyra_safe.usage_events where created_at >= %s and created_at < %s", (cur_start, now))
                cc = c.fetchone()[0]
                c.execute("select coalesce(sum(credits),0) from veyra_safe.usage_events where created_at >= %s and created_at < %s", (prev_start, cur_start))
                out["metrics"]["credits_used"] = _delta(cc, c.fetchone()[0])
                c.execute("select count(distinct user_id) from veyra_safe.usage_events where created_at >= %s and created_at < %s", (cur_start, now))
                ac = c.fetchone()[0]
                c.execute("select count(distinct user_id) from veyra_safe.usage_events where created_at >= %s and created_at < %s", (prev_start, cur_start))
                out["metrics"]["active_users"] = _delta(ac, c.fetchone()[0])
                c.execute("select coalesce(nullif(model,''),'unknown') m, count(*) n from veyra_safe.usage_events where created_at >= %s group by 1 order by 2 desc limit 6", (cur_start,))
                out["breakdowns"]["prompts_by_model"] = [{"model": m, "count": n} for m, n in c.fetchall()]
            except Exception as e:
                out["metrics"]["prompts"] = {"error": str(e)[:100]}

            try:
                c.execute("select count(*), coalesce(sum(amount),0) from veyra_safe.payment_records where status='succeeded' and created_at >= %s and created_at < %s", (cur_start, now))
                pc, prv = c.fetchone()
                c.execute("select count(*), coalesce(sum(amount),0) from veyra_safe.payment_records where status='succeeded' and created_at >= %s and created_at < %s", (prev_start, cur_start))
                ppc, pprv = c.fetchone()
                out["metrics"]["payments"] = _delta(pc, ppc)
                out["metrics"]["revenue"] = _delta(float(prv), float(pprv))
            except Exception as e:
                out["metrics"]["payments"] = {"error": str(e)[:100]}
        return out
    except Exception as exc:
        return {"configured": True, "error": str(exc)}


def _quaniac(period):
    import httpx
    svc = vault.get_secret("quaniac_service_key")
    cs  = vault.get_secret("quaniac_pg_ro")
    if not svc and not cs:
        return {"configured": False}

    now, cur_start, prev_start, _ = _windows(period)
    out = {"configured": True, "metrics": {}}

    # Try psycopg first if DSN is set
    if cs:
        try:
            import psycopg
            with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
                c = conn.cursor()

                def cnt(table, col, start, end, extra=""):
                    c.execute(f"select count(*) from {table} where {col} >= %s and {col} < %s {extra}", (start, end))
                    return c.fetchone()[0]

                out["metrics"]["visits"] = _delta(
                    cnt("veyra_safe.page_views", "created_at", cur_start, now),
                    cnt("veyra_safe.page_views", "created_at", prev_start, cur_start))
                out["metrics"]["blog_reads"] = _delta(
                    cnt("veyra_safe.page_views", "created_at", cur_start, now, "AND blog_slug IS NOT NULL AND blog_slug <> ''"),
                    cnt("veyra_safe.page_views", "created_at", prev_start, cur_start, "AND blog_slug IS NOT NULL AND blog_slug <> ''"))
                out["metrics"]["subscribers"] = _delta(
                    cnt("veyra_safe.newsletter_subscribers", "created_at", cur_start, now),
                    cnt("veyra_safe.newsletter_subscribers", "created_at", prev_start, cur_start))
                out["metrics"]["contact_chats"] = _delta(
                    cnt("veyra_safe.chat_threads", "created_at", cur_start, now),
                    cnt("veyra_safe.chat_threads", "created_at", prev_start, cur_start))
                c.execute("select count(distinct visitor_id) from veyra_safe.page_views "
                          "where created_at >= %s and created_at < %s and visitor_id <> ''", (cur_start, now))
                out["metrics"]["unique_visitors"] = {"current": c.fetchone()[0]}
            return out
        except Exception:
            pass  # fall through to REST

    # REST fallback via PostgREST + service key
    if not svc:
        return {"configured": False}
    base = "https://fyggkofmzbvlijilpsft.supabase.co/rest/v1"
    headers = {"apikey": svc, "Authorization": f"Bearer {svc}"}

    def rest_count(table, col, start, end, extra_params=None):
        params = {col: f"gte.{start.isoformat()}", f"{col}2": f"lt.{end.isoformat()}",
                  "select": "id"}
        if extra_params:
            params.update(extra_params)
        try:
            r = httpx.get(f"{base}/{table}", headers={**headers, "Prefer": "count=exact"},
                          params=params, timeout=10)
            # PostgREST returns count in Content-Range header: "0-N/TOTAL"
            cr = r.headers.get("content-range", "")
            total = cr.split("/")[-1] if "/" in cr else str(len(r.json() or []))
            return int(total) if total.isdigit() else len(r.json() or [])
        except Exception:
            return 0

    # For page_views use a wider fetch and filter in Python (avoids two-column param clash)
    try:
        r = httpx.get(f"{base}/page_views",
                      headers=headers,
                      params={"select": "created_at,visitor_id,blog_slug",
                              "created_at": f"gte.{prev_start.isoformat()}", "limit": "10000"},
                      timeout=15)
        views = r.json() if r.status_code == 200 else []
    except Exception:
        views = []

    cur_s  = cur_start.isoformat()
    now_s  = now.isoformat()
    prev_s = prev_start.isoformat()

    cur_v  = [v for v in views if cur_s  <= (v.get("created_at") or "") < now_s]
    prev_v = [v for v in views if prev_s <= (v.get("created_at") or "") < cur_s]

    out["metrics"]["visits"] = _delta(len(cur_v), len(prev_v))
    out["metrics"]["blog_reads"] = _delta(
        sum(1 for v in cur_v  if v.get("blog_slug")),
        sum(1 for v in prev_v if v.get("blog_slug")))
    out["metrics"]["unique_visitors"] = {
        "current": len({v.get("visitor_id") for v in cur_v if v.get("visitor_id")})}

    try:
        sr = httpx.get(f"{base}/newsletter_subscribers",
                       headers=headers,
                       params={"select": "created_at", "limit": "5000"}, timeout=10)
        subs = sr.json() if sr.status_code == 200 else []
    except Exception:
        subs = []
    out["metrics"]["subscribers"] = _delta(
        sum(1 for s in subs if cur_s  <= (s.get("created_at") or "") < now_s),
        sum(1 for s in subs if prev_s <= (s.get("created_at") or "") < cur_s))

    try:
        tr = httpx.get(f"{base}/chat_threads",
                       headers=headers,
                       params={"select": "created_at", "limit": "2000"}, timeout=10)
        threads = tr.json() if tr.status_code == 200 else []
    except Exception:
        threads = []
    out["metrics"]["contact_chats"] = _delta(
        sum(1 for t in threads if cur_s  <= (t.get("created_at") or "") < now_s),
        sum(1 for t in threads if prev_s <= (t.get("created_at") or "") < cur_s))

    out["via"] = "rest"
    return out


@tool("analytics.report", Tier.SAFE,
      "Cross-product analytics with % change vs the prior period (signups, prompts, revenue, traffic)",
      network=True)
def report(period="week"):
    period = (period or "week").lower()
    if period not in ("day", "week", "month"):
        period = "week"
    # the two products are independent — query them concurrently to cut latency
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as ex:
        fe = ex.submit(_estoppel, period)
        fq = ex.submit(_quaniac, period)
        estoppel = fe.result()
        quaniac = fq.result()
    return {
        "ok": True,
        "period": period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "estoppel": estoppel,
        "quaniac": quaniac,
    }
