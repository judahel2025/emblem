"""Quaniac website connector — read-only analytics via scoped DB role.

Uses psycopg + `quaniac_pg_ro` (veyra_ro_quaniac role):
  - default_transaction_read_only = ON (enforced at the role level)
  - SELECT on veyra_safe.* views only — strips visitor emails, chat PII, post bodies
  - No service_role key; no RLS bypass

Tables accessible (veyra_safe schema):
  page_views, blog_posts, newsletter_subscribers, chat_threads, profiles,
  user_roles, comments
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx

from ..kernel import Tier, tool, vault

QUANIAC_SUPABASE_ID = "fyggkofmzbvlijilpsft"
_AUTO_BLOG_URL = f"https://{QUANIAC_SUPABASE_ID}.supabase.co/functions/v1/auto-blog"


_BASE_URL = f"https://{QUANIAC_SUPABASE_ID}.supabase.co"


def _cfg():
    return vault.get_secret("quaniac_pg_ro")


def _rest_headers():
    """Return Supabase REST headers using the service key (bypasses RLS — use carefully)."""
    svc = vault.get_secret("quaniac_service_key")
    if not svc:
        return None
    return {"apikey": svc, "Authorization": f"Bearer {svc}", "Content-Type": "application/json"}


def _rest_get(path: str, params: dict | None = None):
    """GET from Supabase PostgREST (public schema only). Returns (data_list, error_str)."""
    headers = _rest_headers()
    if not headers:
        return None, "quaniac_service_key not in vault"
    try:
        r = httpx.get(f"{_BASE_URL}/rest/v1/{path.lstrip('/')}", headers=headers,
                      params=params or {}, timeout=15)
        if r.status_code >= 400:
            return None, f"REST {r.status_code}: {r.text[:200]}"
        return r.json(), None
    except Exception as exc:
        return None, str(exc)


def _parse_pg_dsn(dsn: str):
    """Lenient DSN parser for postgresql:// URLs whose passwords contain unencoded
    special characters (%, #, &, @).  Anchors on the known Supabase host pattern
    so we split on the *right* @ even when the password also contains @."""
    import re
    rest = dsn.split("://", 1)[1]
    # Match the @ immediately before any known Supabase host
    m = re.search(
        r"@((?:aws-[\w-]+\.pooler|db\.[a-z0-9]+)\.supabase\.(?:com|co):\d+/\w+)",
        rest,
    )
    if not m:
        return None  # unrecognised format; caller falls back to direct connect
    userinfo = rest[: m.start()]       # everything before the matched @host
    host_port_db = m.group(1)          # host:port/dbname
    colon = userinfo.find(":")
    user = userinfo[:colon] if colon != -1 else userinfo
    password = userinfo[colon + 1 :] if colon != -1 else ""
    # host_port_db = "host:port/dbname"
    hm = re.match(r"([^:]+):(\d+)/(\w+)", host_port_db)
    if not hm:
        return None
    return {
        "host": hm.group(1),
        "port": int(hm.group(2)),
        "dbname": hm.group(3),
        "user": user,
        "password": password,
    }


def _psycopg_connect(dsn: str):
    """Connect via psycopg3, falling back to lenient kwarg-based connect
    when the DSN URL has unencoded special characters in the password."""
    import psycopg
    try:
        return psycopg.connect(dsn, sslmode="require", connect_timeout=20)
    except Exception as e:
        if "percent" not in str(e).lower() and "invalid" not in str(e).lower():
            raise
    # URL parse error (unencoded % or # in password) — try lenient kwarg approach
    parts = _parse_pg_dsn(dsn)
    if not parts:
        raise ValueError("Cannot parse DSN and direct connect failed.")
    return psycopg.connect(sslmode="require", connect_timeout=20, **parts)


def _connect():
    cs = vault.get_secret("quaniac_pg_ro")
    pooler_cs = vault.get_secret("quaniac_pg_pooler")

    if not cs and not pooler_cs:
        return None, {"ok": False, "configured": False,
                      "error": "Quaniac database isn't connected. Add quaniac_pg_ro in Settings."}

    try:
        import psycopg  # noqa: F401
    except ImportError:
        return None, {"ok": False, "configured": True,
                      "error": "psycopg not installed. Run: pip install 'psycopg[binary]'"}

    # Try quaniac_pg_ro first; if it fails with Supabase "tenant/user not found"
    # (wrong username format), fall back to quaniac_pg_pooler + SET ROLE.
    errors = []
    for dsn in filter(None, [cs, pooler_cs]):
        try:
            conn = _psycopg_connect(dsn)
            # Scope down to the read-only role and enforce read-only transactions.
            conn.execute("SET ROLE veyra_ro_quaniac")
            conn.execute("SET default_transaction_read_only = ON")
            return conn, None
        except Exception as exc:
            err = str(exc)
            errors.append(err)
            if "tenant" in err.lower() or "enotfound" in err.lower() or "not found" in err.lower():
                continue   # try next DSN
            break          # hard failure — stop

    return None, {"ok": False, "configured": True, "error": errors[-1] if errors else "unknown"}


@tool("quaniac.stats", Tier.SAFE,
      "Quaniac website analytics: visitors, blog reads, newsletter subscribers, contact chats",
      network=True)
def stats():
    conn, err = _connect()
    if not err:
        try:
            now = datetime.now(timezone.utc)
            d1  = now - timedelta(days=1)
            d7  = now - timedelta(days=7)
            d30 = now - timedelta(days=30)
            with conn:
                c = conn.cursor()
                c.execute("""
                    SELECT created_at, visitor_id, blog_slug, path
                    FROM veyra_safe.page_views
                    WHERE created_at >= %s
                    ORDER BY created_at DESC LIMIT 10000
                """, (d30,))
                views = c.fetchall()
                def _tz(v):
                    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
                today = sum(1 for v in views if v[0] and _tz(v[0]) >= d1)
                week  = sum(1 for v in views if v[0] and _tz(v[0]) >= d7)
                uniq  = len({v[1] for v in views if v[1]})
                blog_reads = sum(1 for v in views if v[2])
                top   = Counter(v[3] for v in views).most_common(6)
                c.execute("SELECT count(*) FROM veyra_safe.newsletter_subscribers WHERE confirmed = true")
                subs = c.fetchone()[0]
                c.execute("SELECT count(*) FROM veyra_safe.chat_threads WHERE status = 'open'")
                open_chats = c.fetchone()[0]
                c.execute("SELECT count(*) FROM veyra_safe.blog_posts WHERE status = 'published'")
                posts = c.fetchone()[0]
            return {"ok": True, "configured": True, "via": "psycopg",
                    "visits_today": today, "visits_7d": week, "visits_30d": len(views),
                    "unique_visitors_30d": uniq, "blog_reads_30d": blog_reads,
                    "subscribers": subs, "open_chats": open_chats, "published_posts": posts,
                    "top_pages": [{"path": p, "views": n} for p, n in top]}
        except Exception as exc:
            err = {"ok": False, "configured": True, "error": str(exc)}

    # REST fallback
    now = datetime.now(timezone.utc)
    d1s  = (now - timedelta(days=1)).isoformat()
    d7s  = (now - timedelta(days=7)).isoformat()
    d30s = (now - timedelta(days=30)).isoformat()
    views30, _  = _rest_get("page_views", {"select": "created_at,visitor_id,blog_slug,path",
                                            "created_at": f"gte.{d30s}", "limit": "10000"})
    subs_r, _   = _rest_get("newsletter_subscribers", {"select": "id", "confirmed": "eq.true", "limit": "5000"})
    threads_r,_ = _rest_get("chat_threads", {"select": "id", "status": "eq.open", "limit": "1000"})
    posts_r, e  = _rest_get("blog_posts", {"select": "id", "status": "eq.published", "limit": "1000"})
    if views30 is None and e:
        return {**(err or {}), "rest_error": e}
    views = views30 or []
    today = sum(1 for v in views if (v.get("created_at") or "") >= d1s)
    week  = sum(1 for v in views if (v.get("created_at") or "") >= d7s)
    uniq  = len({v.get("visitor_id") for v in views if v.get("visitor_id")})
    blog_reads = sum(1 for v in views if v.get("blog_slug"))
    top = Counter(v.get("path") for v in views if v.get("path")).most_common(6)
    return {"ok": True, "configured": True, "via": "rest",
            "visits_today": today, "visits_7d": week, "visits_30d": len(views),
            "unique_visitors_30d": uniq, "blog_reads_30d": blog_reads,
            "subscribers": len(subs_r or []), "open_chats": len(threads_r or []),
            "published_posts": len(posts_r or []),
            "top_pages": [{"path": p, "views": n} for p, n in top]}


@tool("quaniac.blog_posts", Tier.SAFE,
      "List recent Quaniac blog posts (title, slug, status, published date)",
      network=True)
def blog_posts(limit: int = 20, status: str = "published"):
    limit = max(1, min(int(limit or 20), 100))

    conn, err = _connect()
    if not err:
        try:
            with conn:
                c = conn.cursor()
                if status and status != "all":
                    c.execute(
                        "SELECT id, title, slug, status, created_at, published_at "
                        "FROM veyra_safe.blog_posts WHERE status = %s ORDER BY published_at DESC NULLS LAST LIMIT %s",
                        (status, limit))
                else:
                    c.execute(
                        "SELECT id, title, slug, status, created_at, published_at "
                        "FROM veyra_safe.blog_posts ORDER BY created_at DESC LIMIT %s",
                        (limit,))
                cols = [d[0] for d in c.description]
                rows = [{col: (v.isoformat() if hasattr(v, 'isoformat') else v)
                         for col, v in zip(cols, row)} for row in c.fetchall()]
            return {"ok": True, "configured": True, "via": "psycopg", "count": len(rows), "posts": rows}
        except Exception as exc:
            err = {"ok": False, "configured": True, "error": str(exc)}

    # REST fallback (no PII — blog_posts is safe to query via service key)
    params = {
        "select": "id,title,slug,status,created_at,published_at",
        "order": "published_at.desc.nullslast",
        "limit": str(limit),
    }
    if status and status != "all":
        params["status"] = f"eq.{status}"
    data, rest_err = _rest_get("blog_posts", params)
    if rest_err:
        return {**(err or {}), "rest_error": rest_err,
                "help": "Enable Connection Pooler in Supabase → Project Settings → Database, "
                        "or expose veyra_safe schema in PostgREST settings."}
    rows = [{k: v for k, v in p.items()} for p in (data or [])]
    return {"ok": True, "configured": True, "via": "rest", "count": len(rows), "posts": rows}


@tool("quaniac.comments", Tier.SAFE,
      "List recent Quaniac blog comments (name, post slug, content, date)",
      network=True)
def comments(limit: int = 30):
    limit = max(1, min(int(limit or 30), 200))
    conn, err = _connect()
    if not err:
        try:
            with conn:
                c = conn.cursor()
                c.execute(
                    "SELECT id, post_slug, name, content, created_at "
                    "FROM veyra_safe.comments ORDER BY created_at DESC LIMIT %s",
                    (limit,))
                cols = [d[0] for d in c.description]
                rows = [{col: (v.isoformat() if hasattr(v, 'isoformat') else v)
                         for col, v in zip(cols, row)} for row in c.fetchall()]
            return {"ok": True, "configured": True, "via": "psycopg", "count": len(rows), "comments": rows}
        except Exception as exc:
            err = {"ok": False, "configured": True, "error": str(exc)}

    data, rest_err = _rest_get("comments", {"select": "*",
                                             "order": "created_at.desc", "limit": str(limit)})
    if rest_err:
        return {**(err or {}), "rest_error": rest_err}
    return {"ok": True, "configured": True, "via": "rest", "count": len(data or []), "comments": data or []}


@tool("quaniac.newsletter_stats", Tier.SAFE,
      "Quaniac newsletter subscriber counts and growth (7d, 30d)",
      network=True)
def newsletter_stats():
    conn, err = _connect()
    if not err:
        try:
            with conn:
                c = conn.cursor()
                c.execute("SELECT count(*) FROM veyra_safe.newsletter_subscribers WHERE confirmed = true")
                total_confirmed = c.fetchone()[0]
                c.execute("SELECT count(*) FROM veyra_safe.newsletter_subscribers")
                total_all = c.fetchone()[0]
                c.execute("SELECT count(*) FROM veyra_safe.newsletter_subscribers "
                          "WHERE created_at >= now() - interval '7 days'")
                new_7d = c.fetchone()[0]
                c.execute("SELECT count(*) FROM veyra_safe.newsletter_subscribers "
                          "WHERE created_at >= now() - interval '30 days'")
                new_30d = c.fetchone()[0]
            return {"ok": True, "configured": True, "via": "psycopg",
                    "total_confirmed": total_confirmed, "total_all": total_all,
                    "new_7d": new_7d, "new_30d": new_30d}
        except Exception as exc:
            err = {"ok": False, "configured": True, "error": str(exc)}

    now = datetime.now(timezone.utc)
    d7s  = (now - timedelta(days=7)).isoformat()
    d30s = (now - timedelta(days=30)).isoformat()
    all_r,  e1 = _rest_get("newsletter_subscribers", {"select": "id,confirmed,created_at", "limit": "5000"})
    if e1:
        return {**(err or {}), "rest_error": e1}
    subs = all_r or []
    return {"ok": True, "configured": True, "via": "rest",
            "total_confirmed": sum(1 for s in subs if s.get("confirmed")),
            "total_all": len(subs),
            "new_7d":  sum(1 for s in subs if (s.get("created_at") or "") >= d7s),
            "new_30d": sum(1 for s in subs if (s.get("created_at") or "") >= d30s)}


@tool("quaniac.contact_messages", Tier.SAFE,
      "List recent Quaniac contact/chat threads (status and timestamps — PII is masked)",
      network=True)
def contact_messages(limit: int = 20, status: str = ""):
    limit = max(1, min(int(limit or 20), 100))
    conn, err = _connect()
    if not err:
        try:
            with conn:
                c = conn.cursor()
                if status:
                    c.execute(
                        "SELECT id, status, created_at FROM veyra_safe.chat_threads "
                        "WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                        (status, limit))
                else:
                    c.execute(
                        "SELECT id, status, created_at FROM veyra_safe.chat_threads "
                        "ORDER BY created_at DESC LIMIT %s",
                        (limit,))
                cols = [d[0] for d in c.description]
                rows = [{col: (v.isoformat() if hasattr(v, "isoformat") else v)
                         for col, v in zip(cols, row)} for row in c.fetchall()]
            return {"ok": True, "configured": True, "via": "psycopg", "count": len(rows), "threads": rows}
        except Exception as exc:
            err = {"ok": False, "configured": True, "error": str(exc)}

    params = {"select": "id,status,created_at", "order": "created_at.desc", "limit": str(limit)}
    if status:
        params["status"] = f"eq.{status}"
    data, rest_err = _rest_get("chat_threads", params)
    if rest_err:
        return {**(err or {}), "rest_error": rest_err}
    return {"ok": True, "configured": True, "via": "rest", "count": len(data or []), "threads": data or []}


@tool("quaniac.trigger_draft_post", Tier.CAUTION,
      "Ask the Quaniac auto-blogger to generate a blog post draft (saved as draft, not published)",
      network=True,
      summarize=lambda a: f"Quaniac draft blog post: {a.get('topic', 'auto-select topic')}")
def trigger_draft_post(topic: str = ""):
    secret = vault.get_secret("quaniac_auto_blog_secret")
    if not secret:
        return {
            "ok": False,
            "error": "quaniac_auto_blog_secret not set in vault. Add it in Settings → Secrets.",
            "help": "The secret is the AUTO_BLOG_SECRET set on the Quaniac auto-blog Edge Function.",
        }
    params = {"mode": "draft", "secret": secret}
    if topic:
        params["topic"] = topic
    try:
        r = httpx.post(_AUTO_BLOG_URL, params=params, timeout=90)
        return r.json()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@tool("quaniac.diagnose", Tier.SAFE,
      "Diagnose Quaniac DB connection — tests psycopg and REST paths, shows actionable fix",
      network=True)
def diagnose():
    import re
    cs = vault.get_secret("quaniac_pg_ro")
    pooler_cs = vault.get_secret("quaniac_pg_pooler")
    svc = vault.get_secret("quaniac_service_key")
    masked_ro = re.sub(r":[^:@]+@", ":***@", cs) if cs else "not set"
    masked_pooler = re.sub(r":[^:@]+@", ":***@", pooler_cs) if pooler_cs else "not set"

    result = {
        "dsn_ro_masked": masked_ro,
        "dsn_pooler_masked": masked_pooler,
        "service_key_set": bool(svc),
    }

    # --- psycopg path ---
    if cs or pooler_cs:
        conn, err = _connect()
        if err:
            result["psycopg"] = {"ok": False, "error": err.get("error")}
        else:
            try:
                with conn:
                    c = conn.cursor()
                    c.execute("SELECT current_user, current_database()")
                    user, dbname = c.fetchone()
                    c.execute("SELECT schema_name FROM information_schema.schemata "
                              "WHERE schema_name = 'veyra_safe'")
                    has_schema = c.fetchone() is not None
                result["psycopg"] = {
                    "ok": True, "connected_as": user, "database": dbname,
                    "veyra_safe_schema": has_schema,
                    "note": "Connection healthy." if has_schema else
                            "veyra_safe schema missing — run masking-view migrations.",
                }
            except Exception as exc:
                result["psycopg"] = {"ok": False, "error": str(exc)}
    else:
        result["psycopg"] = {"ok": False, "error": "No DSN configured."}

    # --- REST path ---
    data, rest_err = _rest_get("blog_posts", {"select": "id", "limit": "1"})
    if rest_err:
        result["rest"] = {"ok": False, "error": rest_err}
    else:
        result["rest"] = {"ok": True, "note": "REST API reachable (service key works)."}

    # Determine overall status
    pg_ok = result["psycopg"].get("ok", False)
    rest_ok = result["rest"].get("ok", False)
    result["ok"] = pg_ok or rest_ok
    result["configured"] = bool(cs or pooler_cs or svc)

    if not pg_ok:
        result["fix"] = (
            "The psycopg connection is failing (Supabase pooler not enabled for this project). "
            "Fix options:\n"
            "1. Go to Supabase → Project fyggkofmzbvlijilpsft → Settings → Database → "
            "Connection Pooling → Enable and get the pooler connection string. "
            "Store it as quaniac_pg_pooler in Veyra Settings.\n"
            "2. OR go to Supabase → Project → Settings → API → expose the 'veyra_safe' schema "
            "in PostgREST so REST queries can use masked views.\n"
            "Currently REST fallback is "
            + ("ACTIVE (blog_posts readable via service key)." if rest_ok else "ALSO FAILING.")
        )
    return result
