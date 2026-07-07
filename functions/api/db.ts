interface Env {
  DB: D1Database;
}

export function getDb(env: Env): D1Database {
  return env.DB;
}

export async function isDrawLocked(db: D1Database): Promise<boolean> {
  const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();
  return !!(state?.drawn);
}

export async function acquireDrawLock(db: D1Database): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE sweepstake SET drawn = 1, updated_at = datetime('now') WHERE id = 1 AND drawn = 0"
  ).run();
  return result.meta.changes > 0;
}

import type { GroupStandingRow } from "./sync/standings-helper";

export async function getGroupStandingsRows(db: D1Database): Promise<GroupStandingRow[]> {
  const result = await db.prepare(`
    SELECT
      t.group_letter, t.id as team_id, t.id as id, t.name as team_name, t.name as name, t.flag_emoji, t.eliminated,
      COALESCE(SUM(CASE
        WHEN m.home_team_id = t.id THEN
          CASE
            WHEN m.home_score > m.away_score THEN 3
            WHEN m.home_score = m.away_score THEN 1
            ELSE 0
          END
        WHEN m.away_team_id = t.id THEN
          CASE
            WHEN m.away_score > m.home_score THEN 3
            WHEN m.away_score = m.home_score THEN 1
            ELSE 0
          END
        ELSE 0
      END), 0) as points,
      COALESCE(SUM(CASE
        WHEN m.home_team_id = t.id THEN m.home_score
        WHEN m.away_team_id = t.id THEN m.away_score
        ELSE 0
      END), 0) as goals_for,
      COALESCE(SUM(CASE
        WHEN m.home_team_id = t.id THEN m.away_score
        WHEN m.away_team_id = t.id THEN m.home_score
        ELSE 0
      END), 0) as goals_against,
      COALESCE(SUM(CASE WHEN (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.played = 1 THEN 1 ELSE 0 END), 0) as played
    FROM teams t
    LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.stage = 'group'
    GROUP BY t.id
  `).all();
  return result.results;
}
