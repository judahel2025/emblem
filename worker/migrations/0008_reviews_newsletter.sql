-- Reviews: user feedback (AI-guided or typed), surfaced in the admin console.
CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'typed',   -- 'ai' | 'typed'
    summary    TEXT NOT NULL,                   -- structured complaint summary or the typed text
    transcript TEXT,                            -- full AI conversation JSON (NULL for typed)
    sentiment  TEXT,                            -- 'positive' | 'mixed' | 'negative' | NULL
    status     TEXT NOT NULL DEFAULT 'new',     -- 'new' | 'read'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_user   ON reviews(user_id, id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status, id);

-- Newsletter opt state on the member profile. NULL = never decided (the weekly
-- popup targets exactly these), 0 = explicit no (never ask again), 1 = in.
ALTER TABLE profiles ADD COLUMN newsletter_opt INTEGER;
ALTER TABLE profiles ADD COLUMN newsletter_prompted_at TEXT;

-- Landing-footer subscribers (non-members, email only).
CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    opted      INTEGER NOT NULL DEFAULT 1,
    source     TEXT NOT NULL DEFAULT 'landing',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sent-newsletter history (drafts live client-side; a row is written on send).
CREATE TABLE IF NOT EXISTS newsletters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject    TEXT NOT NULL,
    html       TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
