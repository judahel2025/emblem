-- Emblem D1 schema — generated from backend/emblem/kernel/db.py _SQLITE_SCHEMA
-- (the Python backend's SQLite dialect IS the reference; keep in sync manually)

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
    source      TEXT NOT NULL DEFAULT 'emblem',
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

-- ---- multi-user columns -------------
ALTER TABLE memory ADD COLUMN user_id TEXT;
ALTER TABLE emails ADD COLUMN user_id TEXT;
ALTER TABLE notes ADD COLUMN user_id TEXT;
ALTER TABLE code_sessions ADD COLUMN user_id TEXT;
ALTER TABLE scheduled_tasks ADD COLUMN user_id TEXT;
ALTER TABLE improvements ADD COLUMN user_id TEXT;
ALTER TABLE conversations ADD COLUMN user_id TEXT;
ALTER TABLE alerts ADD COLUMN user_id TEXT;
ALTER TABLE mail_messages ADD COLUMN user_id TEXT;
ALTER TABLE kernel_approvals ADD COLUMN user_id TEXT;
ALTER TABLE kernel_audit ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_code_sessions_user ON code_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_improvements_user ON improvements(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_user ON mail_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_kernel_approvals_user ON kernel_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_kernel_audit_user ON kernel_audit(user_id);

-- ---- auth (built on the Worker: Google OAuth + PBKDF2 passwords) -------------
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,              -- uuid
    email       TEXT NOT NULL UNIQUE,
    pw_hash     TEXT,                          -- hex PBKDF2-SHA256 (null for OAuth-only)
    pw_salt     TEXT,                          -- hex 16 bytes
    google_sub  TEXT UNIQUE,                   -- Google account id (null for password-only)
    verified    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS auth_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT,
    kind        TEXT NOT NULL,                 -- signup | login | google | fail
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
