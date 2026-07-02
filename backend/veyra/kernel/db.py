"""Database access layer — SQLite locally, Postgres (Supabase) in the cloud.

When the VEYRA_PG environment variable is set the module routes all queries to
Postgres via psycopg (v3).  Without it the local SQLite kernel.db is used,
keeping local development dependency-free.
"""

import os
from contextlib import contextmanager

_PG_DSN = os.environ.get("VEYRA_PG")

# ---------------------------------------------------------------------------
# Postgres path
# ---------------------------------------------------------------------------

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS kernel_approvals (
    id           BIGSERIAL PRIMARY KEY,
    tool         TEXT NOT NULL,
    summary      TEXT NOT NULL,
    target       TEXT,
    args_json    TEXT NOT NULL,
    risk         TEXT NOT NULL DEFAULT 'high',
    status       TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT NOT NULL DEFAULT 'agent',
    note         TEXT,
    decided_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS kernel_audit (
    id          BIGSERIAL PRIMARY KEY,
    actor       TEXT NOT NULL,
    tool        TEXT NOT NULL,
    tier        TEXT NOT NULL,
    args_json   TEXT NOT NULL,
    status      TEXT NOT NULL,
    result      TEXT,
    approval_id BIGINT,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS kernel_secrets (
    name        TEXT PRIMARY KEY,
    value_blob  TEXT NOT NULL,
    protected   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS kernel_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT    NOT NULL DEFAULT 'fact',
    content     TEXT    NOT NULL,
    embedding   TEXT,
    source      TEXT    NOT NULL DEFAULT 'user',
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS memory_versions (
    id          BIGSERIAL PRIMARY KEY,
    memory_id   BIGINT  NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    content     TEXT    NOT NULL,
    kind        TEXT    NOT NULL DEFAULT 'fact',
    created_at  TEXT    NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_memver_mid ON memory_versions(memory_id);

CREATE TABLE IF NOT EXISTS emails (
    id          BIGSERIAL PRIMARY KEY,
    recipient   TEXT NOT NULL DEFAULT '',
    subject     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS notes (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT 'default',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS kernel_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    original_path TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    reason        TEXT,
    restored      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS code_sessions (
    id          BIGSERIAL PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    tool        TEXT NOT NULL,
    args_json   TEXT NOT NULL DEFAULT '{}',
    every_secs  INTEGER NOT NULL DEFAULT 86400,
    next_run    TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    runs_done   INTEGER NOT NULL DEFAULT 0,
    runs_total  INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'active',
    last_run    TEXT,
    last_result TEXT,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS improvements (
    id          BIGSERIAL PRIMARY KEY,
    area        TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS conversations (
    id          BIGSERIAL PRIMARY KEY,
    role        TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS alerts (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    data_json   TEXT NOT NULL DEFAULT '{}',
    seen        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS mail_messages (
    id          BIGSERIAL PRIMARY KEY,
    direction   TEXT NOT NULL DEFAULT 'inbound',
    from_addr   TEXT NOT NULL DEFAULT '',
    to_addr     TEXT NOT NULL DEFAULT '',
    subject     TEXT NOT NULL DEFAULT '',
    text_body   TEXT NOT NULL DEFAULT '',
    html_body   TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'unread',
    notified    INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_mail_status ON mail_messages(status, received_at);

CREATE TABLE IF NOT EXISTS profiles (
    user_id     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    tone        TEXT NOT NULL DEFAULT 'warm, concise, decisive',
    onboarded   BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_start TEXT NOT NULL DEFAULT '22:00',
    quiet_end   TEXT NOT NULL DEFAULT '07:00',
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS connections (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    toolkit     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'connected',
    account_ref TEXT,
    calls_used  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS pages (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    blocks      TEXT NOT NULL DEFAULT '[]',
    icon        TEXT NOT NULL DEFAULT '',
    archived    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_pages_user ON pages(user_id);

CREATE TABLE IF NOT EXISTS calendar_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    starts_at   TEXT NOT NULL,
    ends_at     TEXT,
    all_day     BOOLEAN NOT NULL DEFAULT FALSE,
    source      TEXT NOT NULL DEFAULT 'veyra',
    external_id TEXT,
    remind_secs INTEGER,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_cal_user ON calendar_events(user_id);

CREATE TABLE IF NOT EXISTS automations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    instruction TEXT NOT NULL DEFAULT '',
    every_secs  INTEGER NOT NULL DEFAULT 86400,
    next_run    TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_aware BOOLEAN NOT NULL DEFAULT TRUE,
    last_run    TEXT,
    last_result TEXT,
    created_at  TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_auto_user ON automations(user_id);
"""

_PG_MIGRATIONS = [
    "ALTER TABLE memory ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0",
    # Multi-user: self-healing user_id columns (the out-of-band migration also adds these).
    "ALTER TABLE notes            ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE memory           ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE conversations    ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE alerts           ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE emails           ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE mail_messages    ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE code_sessions    ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE scheduled_tasks  ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE improvements     ADD COLUMN IF NOT EXISTS user_id TEXT",
    "ALTER TABLE kernel_approvals ADD COLUMN IF NOT EXISTS user_id TEXT",
    # code_sessions: path uniqueness becomes per-user in the multi-user cloud.
    "ALTER TABLE code_sessions DROP CONSTRAINT IF EXISTS code_sessions_path_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_code_user_path ON code_sessions(user_id, path)",
]


def _adapt(sql: str) -> str:
    """Convert SQLite-style SQL to Postgres-compatible SQL."""
    return (
        sql
        .replace("?", "%s")
        .replace("datetime('now')", "to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')")
    )


@contextmanager
def _pg_connect():
    import psycopg
    from psycopg.rows import dict_row
    conn = psycopg.connect(_PG_DSN, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _pg_init_db():
    with _pg_connect() as conn:
        conn.execute(_PG_SCHEMA)
        for migration in _PG_MIGRATIONS:
            try:
                conn.execute(migration)
            except Exception:
                conn.rollback()


def _pg_query(sql: str, params=()):
    with _pg_connect() as conn:
        cur = conn.execute(_adapt(sql), params)
        return cur.fetchall()


def _pg_one(sql: str, params=()):
    rows = _pg_query(sql, params)
    return rows[0] if rows else None


def _pg_write(sql: str, params=()):
    adapted = _adapt(sql)
    add_returning = (
        adapted.strip().upper().startswith("INSERT") and
        "ON CONFLICT" not in adapted.upper()
    )
    if add_returning:
        adapted = adapted.rstrip().rstrip(";") + " RETURNING id"
    with _pg_connect() as conn:
        cur = conn.execute(adapted, params)
        if add_returning:
            row = cur.fetchone()
            return row["id"] if row else None
        return None


# ---------------------------------------------------------------------------
# SQLite path (local dev)
# ---------------------------------------------------------------------------

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS kernel_approvals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tool         TEXT NOT NULL,
    summary      TEXT NOT NULL,
    target       TEXT,
    args_json    TEXT NOT NULL,
    risk         TEXT NOT NULL DEFAULT 'high',
    status       TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT NOT NULL DEFAULT 'agent',
    note         TEXT,
    decided_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS kernel_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT NOT NULL,
    tool        TEXT NOT NULL,
    tier        TEXT NOT NULL,
    args_json   TEXT NOT NULL,
    status      TEXT NOT NULL,
    result      TEXT,
    approval_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kernel_secrets (
    name        TEXT PRIMARY KEY,
    value_blob  BLOB NOT NULL,
    protected   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kernel_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL DEFAULT 'fact',
    content     TEXT    NOT NULL,
    embedding   TEXT,
    source      TEXT    NOT NULL DEFAULT 'user',
    deleted     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id   INTEGER NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    content     TEXT    NOT NULL,
    kind        TEXT    NOT NULL DEFAULT 'fact',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memver_mid ON memory_versions(memory_id);

CREATE TABLE IF NOT EXISTS emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient   TEXT NOT NULL DEFAULT '',
    subject     TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT 'default',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kernel_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    reason        TEXT,
    restored      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS code_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT '',
    tool        TEXT NOT NULL,
    args_json   TEXT NOT NULL DEFAULT '{}',
    every_secs  INTEGER NOT NULL DEFAULT 86400,
    next_run    TEXT NOT NULL DEFAULT (datetime('now')),
    runs_done   INTEGER NOT NULL DEFAULT 0,
    runs_total  INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'active',
    last_run    TEXT,
    last_result TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS improvements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    area        TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    role        TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    data_json   TEXT NOT NULL DEFAULT '{}',
    seen        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mail_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    direction   TEXT NOT NULL DEFAULT 'inbound',
    from_addr   TEXT NOT NULL DEFAULT '',
    to_addr     TEXT NOT NULL DEFAULT '',
    subject     TEXT NOT NULL DEFAULT '',
    text_body   TEXT NOT NULL DEFAULT '',
    html_body   TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'unread',
    notified    INTEGER NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_status ON mail_messages(status, received_at);

CREATE TABLE IF NOT EXISTS profiles (
    user_id     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    tone        TEXT NOT NULL DEFAULT 'warm, concise, decisive',
    onboarded   INTEGER NOT NULL DEFAULT 0,
    quiet_start TEXT NOT NULL DEFAULT '22:00',
    quiet_end   TEXT NOT NULL DEFAULT '07:00',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    toolkit     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'connected',
    account_ref TEXT,
    calls_used  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    blocks      TEXT NOT NULL DEFAULT '[]',
    icon        TEXT NOT NULL DEFAULT '',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    starts_at   TEXT NOT NULL,
    ends_at     TEXT,
    all_day     INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT 'veyra',
    external_id TEXT,
    remind_secs INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    instruction TEXT NOT NULL DEFAULT '',
    every_secs  INTEGER NOT NULL DEFAULT 86400,
    next_run    TEXT NOT NULL DEFAULT (datetime('now')),
    enabled     INTEGER NOT NULL DEFAULT 1,
    quiet_aware INTEGER NOT NULL DEFAULT 1,
    last_run    TEXT,
    last_result TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_SQLITE_MIGRATIONS = [
    "ALTER TABLE memory ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
]


@contextmanager
def _sqlite_connect():
    import sqlite3
    from . import paths
    conn = sqlite3.connect(paths.KERNEL_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
        conn.commit()
    finally:
        conn.close()


def _sqlite_init_db():
    from . import paths
    paths.ensure_dirs()
    with _sqlite_connect() as db:
        db.executescript(_SQLITE_SCHEMA)
        for migration in _SQLITE_MIGRATIONS:
            try:
                db.execute(migration)
            except Exception:
                pass


def _sqlite_query(sql: str, params=()):
    with _sqlite_connect() as db:
        return [dict(row) for row in db.execute(sql, params).fetchall()]


def _sqlite_one(sql: str, params=()):
    rows = _sqlite_query(sql, params)
    return rows[0] if rows else None


def _sqlite_write(sql: str, params=()):
    with _sqlite_connect() as db:
        cur = db.execute(sql, params)
        return cur.lastrowid


# ---------------------------------------------------------------------------
# Public API — routes to Postgres or SQLite transparently
# ---------------------------------------------------------------------------

if _PG_DSN:
    init_db = _pg_init_db
    query = _pg_query
    one = _pg_one
    write = _pg_write

    @contextmanager
    def connect():
        with _pg_connect() as conn:
            yield conn
else:
    init_db = _sqlite_init_db
    query = _sqlite_query
    one = _sqlite_one
    write = _sqlite_write

    connect = _sqlite_connect
