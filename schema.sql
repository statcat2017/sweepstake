-- Sweepstake state (singleton row)
CREATE TABLE IF NOT EXISTS sweepstake (
  id INTEGER PRIMARY KEY DEFAULT 1,
  drawn INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- World Cup teams
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  group_letter TEXT NOT NULL,
  flag_emoji TEXT,
  eliminated INTEGER NOT NULL DEFAULT 0
);

-- Participants in the sweepstake
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which teams each participant drew
CREATE TABLE IF NOT EXISTS participant_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  bonus INTEGER NOT NULL DEFAULT 0,
  UNIQUE(team_id),
  UNIQUE(participant_id, team_id)
);

-- Match schedule and results
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL CHECK (stage IN ('group', 'round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final')),
  group_letter TEXT,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  played INTEGER NOT NULL DEFAULT 0,
  knockout_bracket_slot INTEGER,
  kickoff_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Track who has which knockout teams (after group stage resolves)
CREATE TABLE IF NOT EXISTS knockout_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE(participant_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_group ON teams(group_letter);
CREATE INDEX IF NOT EXISTS idx_matches_stage ON matches(stage);
CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_letter);
CREATE INDEX IF NOT EXISTS idx_participant_teams_participant ON participant_teams(participant_id);
CREATE INDEX IF NOT EXISTS idx_knockout_picks_participant ON knockout_picks(participant_id);
