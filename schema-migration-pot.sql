-- Run once: ALTER TABLE participant_teams ADD COLUMN pot INTEGER;
-- schema.sql already includes pot, so this is only needed for existing databases.
ALTER TABLE participant_teams ADD COLUMN pot INTEGER;
