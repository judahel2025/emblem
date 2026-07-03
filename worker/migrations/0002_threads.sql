-- ChatGPT-style conversation threads. Legacy rows keep thread_id NULL and are
-- shown as one "Earlier" bucket in the sidebar.
CREATE TABLE IF NOT EXISTS threads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'New chat',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id, updated_at DESC);

ALTER TABLE conversations ADD COLUMN thread_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_conversations_thread ON conversations(thread_id);
