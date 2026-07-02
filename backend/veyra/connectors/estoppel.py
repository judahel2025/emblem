"""Estoppel connector — scoped read access via veyra_ro_estoppel role.

Connects via the session pooler using `estoppel_pg_ro` (vault secret).
That role has:
  - default_transaction_read_only = ON (enforced at the role level)
  - SELECT on veyra_safe.* views only (users/profiles/payments/etc. — PII-masked)
  - No direct access to public.* base tables

Use the `veyra_safe` schema for all queries. SELECT * is safe because masking
views strip password_hash, google_id, supabase_user_id, personal_preferences, etc.

AI model reference (from ai_engine/providers.py — kept in sync manually):
  gemini-2.5-flash       → "Estoppel AI"     (Gemini, thinking_budget=1024)
  cerebras-gpt-oss-120b  → "Estoppel Draft"  (Cerebras, fast drafting)
  + Deep mode toggle (dual-agent: Reasoner + Researcher, web research)
"""

import datetime
import decimal
import re

from ..kernel import Tier, tool, vault

# All known Estoppel AI models (mirrors ai_engine/providers.py AI_MODEL_CONFIGS).
_ESTOPPEL_MODELS = [
    {
        "id": "gemini-2.5-flash",
        "label": "Estoppel AI",
        "provider": "Google Gemini",
        "description": "Fast review of extracted case materials; extended thinking enabled (budget 1024 tokens).",
        "default": True,
    },
    {
        "id": "cerebras-gpt-oss-120b",
        "label": "Estoppel Draft",
        "provider": "Cerebras",
        "description": "Rapid drafting and argument alternatives; OpenAI-compatible, no thinking.",
        "default": False,
    },
]

_ESTOPPEL_MODES = [
    {
        "id": "deep",
        "label": "Deep Analysis",
        "description": "Two-agent mode: a Reasoner + a web Researcher work the question before composing the answer. "
                       "Slower but far deeper. Activated via the Deep toggle in the chat input bar.",
    },
    {
        "id": "document",
        "label": "Document Generation",
        "description": "Detected automatically from the prompt (e.g. 'draft a brief', 'write a contract'). "
                       "Generates full DOCX/PDF/PPTX/XLSX documents with project metadata embedded.",
    },
    {
        "id": "research",
        "label": "Web Research",
        "description": "Triggered automatically for research-intent prompts. Gemini uses native Google Search "
                       "grounding; other providers use the scraper fallback.",
    },
]


def _conn_str():
    return vault.get_secret("estoppel_pg_ro")


def _parse_pg_dsn(dsn: str):
    """Lenient DSN parser for postgresql:// URLs with unencoded passwords (%, #, @, &).
    Anchors on the known Supabase host pattern so we split on the right @ even
    when the password also contains @."""
    rest = dsn.split("://", 1)[1]
    m = re.search(
        r"@((?:aws-[\w-]+\.pooler|db\.[a-z0-9]+)\.supabase\.(?:com|co):\d+/\w+)",
        rest,
    )
    if not m:
        return None
    userinfo = rest[: m.start()]
    host_port_db = m.group(1)
    colon = userinfo.find(":")
    user = userinfo[:colon] if colon != -1 else userinfo
    password = userinfo[colon + 1 :] if colon != -1 else ""
    hm = re.match(r"([^:]+):(\d+)/(\w+)", host_port_db)
    if not hm:
        return None
    return {"host": hm.group(1), "port": int(hm.group(2)), "dbname": hm.group(3),
            "user": user, "password": password}


def _psycopg_connect(dsn: str):
    """Connect via psycopg3; falls back to lenient kwarg-based connect
    when the DSN URL has unencoded special characters in the password."""
    import psycopg
    try:
        return psycopg.connect(dsn, sslmode="require", connect_timeout=20)
    except Exception as e:
        if "percent" not in str(e).lower() and "invalid" not in str(e).lower():
            raise
    parts = _parse_pg_dsn(dsn)
    if not parts:
        raise ValueError("Cannot parse DSN and direct connect failed.")
    return psycopg.connect(sslmode="require", connect_timeout=20, **parts)


def _connect():
    cs = _conn_str()
    if not cs:
        return None, {"ok": False, "configured": False,
                      "error": "Estoppel database isn't connected yet. Add estoppel_pg_ro in Settings."}
    try:
        import psycopg  # noqa: F401
    except Exception:
        return None, {"ok": False, "configured": True, "error": "psycopg not installed on the backend."}
    # Try DSNs in order; fall back on Supabase pooler "tenant not found" errors.
    pooler_cs = vault.get_secret("estoppel_pg_pooler")
    errors = []
    for dsn in filter(None, [cs, pooler_cs]):
        try:
            conn = _psycopg_connect(dsn)
            return conn, None
        except Exception as exc:
            err = str(exc)
            errors.append(err)
            if "tenant" in err.lower() or "enotfound" in err.lower() or "not found" in err.lower():
                continue
            break
    return None, {"ok": False, "configured": True, "error": errors[-1] if errors else "unknown"}


def _safe(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "<binary>"
    return v


def _rows(cur):
    cols = [d[0] for d in cur.description] if cur.description else []
    return [{c: _safe(v) for c, v in zip(cols, row)} for row in cur.fetchall()]


@tool("estoppel.ai_models", Tier.SAFE,
      "List all Estoppel AI models and modes (Deep Analysis, Document Generation, Web Research)")
def ai_models():
    """Returns the full catalogue of AI capabilities Estoppel exposes.
    Models are Gemini 2.5 Flash (default) and Cerebras Draft.
    Modes include Deep Analysis, Document Generation, and Web Research."""
    return {
        "ok": True,
        "default_model": "gemini-2.5-flash",
        "models": _ESTOPPEL_MODELS,
        "modes": _ESTOPPEL_MODES,
        "note": (
            "Model selection is per-chat (dropdown in the chat header). "
            "Deep mode and document generation are request-level toggles. "
            "Gemini falls back to Cerebras automatically on transient provider errors."
        ),
    }


@tool("estoppel.ai_usage", Tier.SAFE,
      "Estoppel AI usage: messages sent, document jobs generated, model usage breakdown",
      network=True)
def ai_usage():
    conn, err = _connect()
    if err:
        return err
    try:
        with conn:
            cur = conn.cursor()
            out = {"ok": True, "configured": True}

            # Total AI messages
            cur.execute("SELECT count(*) FROM veyra_safe.messages WHERE role = 'ai'")
            out["total_ai_messages"] = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM veyra_safe.messages WHERE role = 'user'")
            out["total_user_messages"] = cur.fetchone()[0]

            cur.execute(
                "SELECT count(*) FROM veyra_safe.messages WHERE role = 'ai' "
                "AND created_at >= now() - interval '7 days'"
            )
            out["ai_messages_7d"] = cur.fetchone()[0]

            # Document generation jobs
            try:
                cur.execute("SELECT count(*) FROM veyra_safe.document_generation_jobs")
                out["document_jobs_total"] = cur.fetchone()[0]
                cur.execute(
                    "SELECT count(*) FROM veyra_safe.document_generation_jobs "
                    "WHERE status = 'ready'"
                )
                out["document_jobs_ready"] = cur.fetchone()[0]
                cur.execute(
                    "SELECT model, count(*) FROM veyra_safe.document_generation_jobs "
                    "GROUP BY model ORDER BY 2 DESC LIMIT 10"
                )
                out["document_model_breakdown"] = [
                    {"model": m, "count": n} for m, n in cur.fetchall()
                ]
            except Exception:
                out["document_jobs_total"] = None  # table may not be in veyra_safe yet

            return out
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.users", Tier.SAFE,
      "Estoppel user stats: total users, recent signups, login activity, discovery source",
      network=True)
def users():
    cs = _conn_str()
    if not cs:
        return {"ok": False, "configured": False,
                "error": "Estoppel database isn't connected yet. Add estoppel_pg_ro in Settings."}
    try:
        import psycopg
    except Exception:
        return {"ok": False, "configured": True, "error": "psycopg not installed on the backend."}
    try:
        out = {"ok": True, "configured": True}
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM veyra_safe.users")
            out["total_users"] = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM veyra_safe.users WHERE date_joined >= now() - interval '7 days'")
            out["new_7d"] = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM veyra_safe.users WHERE date_joined >= now() - interval '30 days'")
            out["new_30d"] = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM veyra_safe.users WHERE last_login >= now() - interval '7 days'")
            out["active_7d"] = cur.fetchone()[0]
            cur.execute("SELECT email, date_joined FROM veyra_safe.users ORDER BY date_joined DESC LIMIT 8")
            out["recent_signups"] = [{"email": e, "joined": str(d)[:10]} for e, d in cur.fetchall()]
            try:
                cur.execute("SELECT coalesce(nullif(discovery_source,''),'unknown') src, count(*) "
                            "FROM veyra_safe.profiles GROUP BY 1 ORDER BY 2 DESC LIMIT 8")
                out["discovery_sources"] = [{"source": s, "count": n} for s, n in cur.fetchall()]
            except Exception:
                out["discovery_sources"] = []
            try:
                cur.execute("SELECT count(*) FROM veyra_safe.usage_events WHERE created_at >= now() - interval '7 days'")
                out["activity_events_7d"] = cur.fetchone()[0]
            except Exception:
                out["activity_events_7d"] = None
        return out
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.users_list", Tier.SAFE,
      "List Estoppel users with details (paginated; optional search by email/name)",
      network=True)
def users_list(limit: int = 100, offset: int = 0, search: str = ""):
    conn, err = _connect()
    if err:
        return err
    limit = max(1, min(int(limit or 100), 1000))
    offset = max(0, int(offset or 0))
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM veyra_safe.users")
            total = cur.fetchone()[0]
            if (search or "").strip():
                cur.execute(
                    "SELECT * FROM veyra_safe.users WHERE email ILIKE %s "
                    "ORDER BY date_joined DESC LIMIT %s OFFSET %s",
                    (f"%{search.strip()}%", limit, offset))
            else:
                cur.execute("SELECT * FROM veyra_safe.users ORDER BY date_joined DESC LIMIT %s OFFSET %s",
                            (limit, offset))
            users_rows = _rows(cur)
        return {"ok": True, "configured": True, "total_users": total,
                "returned": len(users_rows), "offset": offset, "users": users_rows}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.user", Tier.SAFE, "Look up one Estoppel user by email or id",
      network=True)
def user(identifier: str = ""):
    conn, err = _connect()
    if err:
        return err
    ident = (identifier or "").strip()
    if not ident:
        return {"ok": False, "error": "Provide an email or user id."}
    try:
        with conn:
            cur = conn.cursor()
            if "@" in ident:
                cur.execute("SELECT * FROM veyra_safe.users WHERE email ILIKE %s LIMIT 5", (ident,))
            elif ident.isdigit():
                cur.execute("SELECT * FROM veyra_safe.users WHERE id = %s LIMIT 1", (int(ident),))
            else:
                cur.execute("SELECT * FROM veyra_safe.users WHERE email ILIKE %s LIMIT 5", (f"%{ident}%",))
            rows = _rows(cur)
        if not rows:
            return {"ok": True, "found": False, "matches": []}
        return {"ok": True, "found": True, "matches": rows}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.schema", Tier.SAFE, "List Estoppel tables accessible to Veyra and their columns",
      network=True)
def schema():
    conn, err = _connect()
    if err:
        return err
    try:
        with conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'veyra_safe' ORDER BY table_name, ordinal_position")
            tables = {}
            for t, c, dt in cur.fetchall():
                tables.setdefault(t, []).append({"column": c, "type": dt})
        return {"ok": True, "configured": True, "schema": "veyra_safe", "tables": tables}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.query", Tier.SAFE,
      "Run a read-only SELECT against Estoppel (veyra_safe schema: users/profiles/payments/etc.)",
      network=True, summarize=lambda a: f"Query Estoppel: {str(a.get('sql', ''))[:60]}")
def query(sql: str = "", limit: int = 200):
    conn, err = _connect()
    if err:
        return err
    q = (sql or "").strip().rstrip(";")
    low = q.lower()
    if not (low.startswith("select") or low.startswith("with")):
        return {"ok": False, "error": "Only SELECT/WITH queries are allowed."}
    if ";" in q:
        return {"ok": False, "error": "One statement at a time, please."}
    forbidden = ("insert ", "update ", "delete ", "drop ", "alter ", "truncate ",
                 "create ", "grant ", "revoke ")
    if any(f in low for f in forbidden):
        return {"ok": False, "error": "That query is not read-only."}
    limit = max(1, min(int(limit or 200), 2000))
    if " limit " not in low:
        q = f"{q} LIMIT {limit}"
    try:
        with conn:
            cur = conn.cursor()
            cur.execute("SET LOCAL statement_timeout = '20s'")
            cur.execute(q)
            rows = _rows(cur)
        return {"ok": True, "configured": True, "row_count": len(rows), "rows": rows}
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.traffic", Tier.SAFE,
      "Estoppel website traffic: channels, referrers, UTM campaigns",
      network=True)
def traffic():
    cs = _conn_str()
    if not cs:
        return {"ok": False, "configured": False,
                "error": "Estoppel database isn't connected yet. Add estoppel_pg_ro in Settings."}
    try:
        import psycopg
    except Exception:
        return {"ok": False, "configured": True, "error": "psycopg not installed on the backend."}
    try:
        out = {"ok": True, "configured": True}
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            try:
                cur.execute("SELECT count(*) FROM veyra_safe.site_visits WHERE created_at >= now() - interval '30 days'")
                out["pageviews_30d"] = cur.fetchone()[0]
            except Exception:
                return {"ok": True, "configured": True, "tracking_live": False,
                        "note": "Visit tracking is installed but no visits recorded yet."}
            cur.execute("SELECT count(DISTINCT visitor_id) FROM veyra_safe.site_visits "
                        "WHERE created_at >= now() - interval '30 days' AND visitor_id <> ''")
            out["unique_visitors_30d"] = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM veyra_safe.site_visits WHERE landing AND created_at >= now() - interval '30 days'")
            out["sessions_30d"] = cur.fetchone()[0]
            cur.execute("SELECT channel, count(*) FROM veyra_safe.site_visits "
                        "WHERE landing AND created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC")
            rows = cur.fetchall()
            out["channels"] = [{"channel": c, "sessions": n} for c, n in rows]
            out["from_search_30d"] = sum(n for c, n in rows if c == "search")
            out["from_social_30d"] = sum(n for c, n in rows if c == "social")
            cur.execute("SELECT referrer_host, count(*) FROM veyra_safe.site_visits "
                        "WHERE landing AND referrer_host <> '' AND created_at >= now() - interval '30 days' "
                        "GROUP BY 1 ORDER BY 2 DESC LIMIT 8")
            out["top_referrers"] = [{"host": h, "sessions": n} for h, n in cur.fetchall()]
            cur.execute("SELECT utm_source, count(*) FROM veyra_safe.site_visits "
                        "WHERE landing AND utm_source <> '' AND created_at >= now() - interval '30 days' "
                        "GROUP BY 1 ORDER BY 2 DESC LIMIT 8")
            out["top_campaigns"] = [{"utm_source": s, "sessions": n} for s, n in cur.fetchall()]
        return out
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.traffic_detail", Tier.SAFE,
      "Estoppel traffic breakdown per campaign, referrer, channel, page, or day",
      network=True)
def traffic_detail(days: int = 30, group_by: str = "campaign"):
    """group_by: 'campaign' (utm_source), 'referrer', 'channel', 'page', 'day'"""
    cs = _conn_str()
    if not cs:
        return {"ok": False, "configured": False,
                "error": "Estoppel database isn't connected. Add estoppel_pg_ro in Settings."}
    try:
        import psycopg
    except Exception:
        return {"ok": False, "configured": True, "error": "psycopg not installed."}

    days = max(1, min(int(days or 30), 365))
    GROUP_MAP = {
        "campaign": ("utm_source", "utm_source <> ''"),
        "referrer": ("referrer_host", "referrer_host <> ''"),
        "channel":  ("channel", "1=1"),
        "page":     ("path", "path <> ''"),
        "day":      ("date_trunc('day', created_at)::date", "1=1"),
    }
    group_by = (group_by or "campaign").lower().strip()
    if group_by not in GROUP_MAP:
        group_by = "campaign"
    col, where_extra = GROUP_MAP[group_by]

    try:
        out = {"ok": True, "configured": True, "days": days, "group_by": group_by}
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            try:
                cur.execute(
                    f"SELECT {col} grp, count(*) sessions, "
                    f"count(distinct visitor_id) unique_visitors "
                    f"FROM veyra_safe.site_visits "
                    f"WHERE landing AND created_at >= now() - interval '{days} days' "
                    f"AND {where_extra} "
                    f"GROUP BY 1 ORDER BY 2 DESC LIMIT 20",
                )
                rows = cur.fetchall()
                out["breakdown"] = [{"label": str(r[0] or "(none)"), "sessions": r[1],
                                     "unique_visitors": r[2]} for r in rows]
                out["tracking_live"] = True
            except Exception:
                out["tracking_live"] = False
                out["breakdown"] = []
                out["note"] = "Visit tracking table not yet populated."
        return out
    except Exception as exc:
        return {"ok": False, "configured": True, "error": str(exc)}


@tool("estoppel.activity_check", Tier.SAFE,
      "Check Estoppel for new support messages and signups; raise alerts",
      network=True)
def activity_check():
    cs = _conn_str()
    if not cs:
        return {"ok": False, "error": "Estoppel DB not connected."}
    from ..kernel import config
    from .. import alerts as _alerts
    out = {"ok": True, "new_support": 0, "new_signups": 0}
    try:
        import psycopg
        last_msg = int(config.get("estoppel_last_contact_id", "0") or "0")
        last_user = int(config.get("estoppel_last_user_id", "0") or "0")
        with psycopg.connect(cs, sslmode="require", connect_timeout=20) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, name, email, subject, message FROM veyra_safe.contact_messages "
                        "WHERE id > %s ORDER BY id ASC LIMIT 20", (last_msg,))
            msgs = cur.fetchall()
            for mid, name, email, subject, message in msgs:
                _alerts.raise_alert(
                    kind="support",
                    title=f"New Estoppel support message from {name or email}",
                    body=f"{subject or '(no subject)'} -- {(message or '')[:240]}",
                    data={"contact_id": mid, "from": email, "subject": subject},
                    email=True)
            if msgs:
                config.set("estoppel_last_contact_id", str(msgs[-1][0]))
                out["new_support"] = len(msgs)
            try:
                cur.execute("SELECT id, email FROM veyra_safe.users WHERE id > %s ORDER BY id ASC LIMIT 50", (last_user,))
                newu = cur.fetchall()
                if last_user and newu:
                    _alerts.raise_alert(
                        kind="signup",
                        title=f"{len(newu)} new Estoppel signup(s)",
                        body=", ".join(e for _, e in newu[:10]),
                        data={"emails": [e for _, e in newu]})
                    out["new_signups"] = len(newu)
                if newu:
                    config.set("estoppel_last_user_id", str(newu[-1][0]))
            except Exception:
                pass
        return out
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
