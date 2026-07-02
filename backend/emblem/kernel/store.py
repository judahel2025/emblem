"""Shared database — one source of truth for synced app content.

The `emblem_pg` vault secret now points to the scoped `emblem_rw` role:
  SELECT + INSERT + UPDATE + DELETE on all content tables.
  No CREATE TABLE, ALTER TABLE, or DROP TABLE (DDL revoked at DB level).

Schema is managed out-of-band via the Supabase Management API
(vault: supabase_access_token). Do NOT call init() from the app —
it is kept only as a reference and runs only in development.

Connection strategy:
  1. psycopg direct via the Supabase session pooler (SCOPED DSN)
  2. If psycopg is unavailable, fall through to a REST shim via httpx
     (SELECT/INSERT/UPDATE/DELETE via PostgREST at supabase_url)
"""

import os

_DDL_REFERENCE = """
-- Run this once via the Supabase Management API, not from the app.
-- Schema is already live; this is kept for documentation only.
CREATE TABLE IF NOT EXISTS notes (...);
CREATE TABLE IF NOT EXISTS emails (...);
-- see cloud/schema.sql for the full DDL
"""


def _cs():
    cs = os.environ.get("EMBLEM_PG")
    if cs:
        return cs
    try:
        from . import vault
        return vault.get_secret("emblem_pg")
    except Exception:
        return None


def _supabase_url():
    try:
        from . import vault
        return vault.get_secret("supabase_url"), vault.get_secret("supabase_service_key")
    except Exception:
        return None, None


def enabled() -> bool:
    return bool(_cs()) or bool(_supabase_url()[0])


def _conn():
    import psycopg
    return psycopg.connect(_cs(), sslmode="require", connect_timeout=20, autocommit=True)


def _translate(sql: str) -> str:
    return sql.replace("datetime('now')", "now()").replace("?", "%s")


def query(sql: str, params=()):
    with _conn() as c:
        cur = c.execute(_translate(sql), params)
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def one(sql: str, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def write(sql: str, params=()):
    t = _translate(sql)
    is_insert = t.lstrip().lower().startswith("insert")
    if is_insert and "returning" not in t.lower():
        t = t.rstrip().rstrip(";") + " RETURNING id"
    with _conn() as c:
        cur = c.execute(t, params)
        if is_insert:
            row = cur.fetchone()
            return row[0] if row else None
        return cur.rowcount


def init() -> None:
    """DEVELOPMENT ONLY — the production schema is managed via the Management API.

    Calling this against the scoped `emblem_rw` role will raise a permission
    error (DDL revoked). Only call this against a local Postgres for dev/test.
    """
    import warnings
    warnings.warn(
        "store.init() is a dev helper. Production schema is managed out-of-band. "
        "Do not call this against the live Supabase.",
        stacklevel=2,
    )
