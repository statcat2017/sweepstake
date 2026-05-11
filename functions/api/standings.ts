import { getDb } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();

  if (!state?.drawn) {
    return Response.json({ drawn: false, standings: [], participants: [] });
  }

  const participants = await db.prepare(`
    SELECT
      p.id, p.name,
      COUNT(pt.team_id) as team_count,
      SUM(CASE WHEN t.eliminated = 0 THEN 1 ELSE 0 END) as alive_count
    FROM participants p
    LEFT JOIN participant_teams pt ON pt.participant_id = p.id
    LEFT JOIN teams t ON t.id = pt.team_id
    GROUP BY p.id
    ORDER BY alive_count DESC, p.name
  `).all();

  const teams = await db.prepare(`
    SELECT
      t.id, t.name, t.group_letter, t.flag_emoji, t.eliminated,
      GROUP_CONCAT(pt.participant_id) as participant_ids
    FROM teams t
    LEFT JOIN participant_teams pt ON pt.team_id = t.id
    GROUP BY t.id
    ORDER BY t.group_letter, t.name
  `).all();

  const groupStandings = await db.prepare(`
    SELECT
      t.group_letter, t.id as team_id, t.name as team_name, t.flag_emoji, t.eliminated,
      SUM(CASE
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
      END) as points,
      SUM(CASE
        WHEN m.home_team_id = t.id THEN m.home_score
        WHEN m.away_team_id = t.id THEN m.away_score
        ELSE 0
      END) as goals_for,
      SUM(CASE
        WHEN m.home_team_id = t.id THEN m.away_score
        WHEN m.away_team_id = t.id THEN m.home_score
        ELSE 0
      END) as goals_against,
      SUM(CASE WHEN (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.played = 1 THEN 1 ELSE 0 END) as played
    FROM teams t
    LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.stage = 'group'
    GROUP BY t.id
    ORDER BY t.group_letter, points DESC, (goals_for - goals_against) DESC, goals_for DESC
  `).all();

  return Response.json({
    drawn: true,
    participants: participants.results,
    teams: teams.results,
    groupStandings: groupStandings.results
  });
}
