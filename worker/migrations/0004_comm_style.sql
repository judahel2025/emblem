-- Free-text "master instruction": how the user wants Emblem to talk to them —
-- tone, language pattern, how to be addressed. Injected into the agent every turn.
ALTER TABLE profiles ADD COLUMN comm_style TEXT NOT NULL DEFAULT '';
