-- Run this once on existing databases to add columns added after initial deploy
ALTER TABLE matches ADD COLUMN api_fixture_id INTEGER;
ALTER TABLE matches ADD COLUMN winner_team_id INTEGER REFERENCES teams(id);

-- Add FIFA ranking column for ranked draw
ALTER TABLE teams ADD COLUMN fifa_rank INTEGER;
