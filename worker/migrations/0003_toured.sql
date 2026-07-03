-- Whether the user has taken (or skipped) the guided product tour.
ALTER TABLE profiles ADD COLUMN toured INTEGER NOT NULL DEFAULT 0;
