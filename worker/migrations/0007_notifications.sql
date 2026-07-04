-- Notifications — connector activity (new mail, calendar, social, GitHub…) plus
-- automations/reminders, stored per user, shown on the Notifications page + badge
-- + Chrome popups. Replaces the chat "heads-up".
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    app         TEXT NOT NULL DEFAULT 'system',   -- gmail | googlecalendar | github | linkedin | system…
    kind        TEXT NOT NULL DEFAULT 'info',      -- mail | event | activity | automation | reminder
    title       TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    ref         TEXT,                              -- external id, for dedupe (NULL = always insert)
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id);
-- Same external item never notifies twice (NULLs stay distinct, so system notifs always insert).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, app, ref);

-- Per-user-per-app polling state: throttle + baseline so we don't flood on first check.
CREATE TABLE IF NOT EXISTS connector_watermarks (
    user_id      TEXT NOT NULL,
    app          TEXT NOT NULL,
    last_checked TEXT,
    PRIMARY KEY (user_id, app)
);
