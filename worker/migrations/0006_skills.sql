-- Skills: named, described, reusable instructions the agent follows using native
-- tools (Anthropic's SKILL.md concept, no code sandbox). user_id NULL = built-in
-- master skill (we actually keep built-ins in code; this table is user skills).
CREATE TABLE IF NOT EXISTS skills (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',   -- WHAT it does + WHEN to use (the trigger text)
    instructions TEXT NOT NULL DEFAULT '',   -- the SKILL.md body
    source       TEXT NOT NULL DEFAULT 'user_chat',   -- user_chat | user_paste | imported
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);
