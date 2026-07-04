-- Two-field master instruction (ChatGPT's proven split): comm_style already holds
-- "how Emblem should respond"; about_me holds "what Emblem should know about you".
-- Both injected into the agent every turn, deterministically.
ALTER TABLE profiles ADD COLUMN about_me TEXT NOT NULL DEFAULT '';

-- "Used in this reply" transparency: which memory a saved fact was surfaced from.
-- (No schema change needed for the indicator itself — the agent reports used ids at
-- runtime — but we add a memory 'pinned' flag so a user can lock a fact so recall
-- never drops it, matching the research's manual-control recommendation.)
ALTER TABLE memory ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
