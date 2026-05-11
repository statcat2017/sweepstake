import { getDb, isDrawLocked } from "./db";

function sortByPointsGDGoals(a: any, b: any) {
  const ptsA = a.points ?? 0;
  const ptsB = b.points ?? 0;
  if (ptsB !== ptsA) return ptsB - ptsA;
  const gdA = (a.goals_for ?? 0) - (a.goals_against ?? 0);
  const gdB = (b.goals_for ?? 0) - (b.goals_against ?? 0);
  if (gdB !== gdA) return gdB - gdA;
  return (b.goals_for ?? 0) - (a.goals_for ?? 0);
}

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (!(await isDrawLocked(db))) {
    return Response.json({ drawn: false, standings: [], participants: [] });
  }

  const participantsRaw = await db.prepare(`
    SELECT p.id, p.name
    FROM participants p
    ORDER BY p.name
  `).all();

  const teamsData = await db.prepare(`
    SELECT
      t.id, t.name, t.group_letter, t.flag_emoji, t.eliminated,
      pt.participant_id, pt.bonus
    FROM teams t
    LEFT JOIN participant_teams pt ON pt.team_id = t.id
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
  `).all();

  const groups: Record<string, any[]> = {};
  for (const row of groupStandings.results) {
    row.points = row.points ?? 0;
    row.goals_for = row.goals_for ?? 0;
    row.goals_against = row.goals_against ?? 0;
    row.played = row.played ?? 0;
    if (!groups[row.group_letter]) groups[row.group_letter] = [];
    groups[row.group_letter].push(row);
  }

  const thirdPlaced: any[] = [];
  const teamStatus: Record<number, string> = {};
  const teamPosition: Record<number, number> = {};

  for (const [letter, teams] of Object.entries(groups)) {
    teams.sort(sortByPointsGDGoals);

    const groupComplete = teams.every((t: any) => t.played >= 3);

    teams.forEach((team: any, idx: number) => {
      const pos = idx + 1;
      team.position = pos;
      teamPosition[team.team_id] = pos;

      if (groupComplete) {
        if (idx < 2) {
          team.status = "qualified";
        } else if (idx === 2) {
          team.status = "third";
        } else {
          team.status = "eliminated";
        }
      } else {
        if (idx < 2) {
          team.status = "qualifying";
        } else if (idx === 2) {
          team.status = "contending";
        } else {
          team.status = "eliminating";
        }
      }
      teamStatus[team.team_id] = team.status;
    });

    if (groupComplete) {
      thirdPlaced.push(teams[2]);
    }
  }

  thirdPlaced.sort(sortByPointsGDGoals);
  thirdPlaced.forEach((team: any, idx: number) => {
    team.third_rank = idx + 1;
    const finalStatus = idx < 8 ? "qualified" : "eliminated";
    team.status = finalStatus;
    teamStatus[team.team_id] = finalStatus;
  });

  const participants = participantsRaw.results.map((p: any) => {
    const playerTeams = teamsData.results.filter((t: any) => t.participant_id == p.id);
    const alive = playerTeams.filter((t: any) => {
      const s = teamStatus[t.id];
      return !s || s === "qualified" || s === "qualifying" || s === "contending" || s === "third" || s === "eliminating";
    }).length;
    return { id: p.id, name: p.name, team_count: playerTeams.length, alive_count: alive };
  });

  const teams = teamsData.results.map((t: any) => ({
    ...t,
    status: teamStatus[t.id] || null
  }));

  const flattened = Object.values(groups).flat();

  return Response.json({
    drawn: true,
    participants,
    teams,
    groupStandings: flattened,
    thirdPlaceRanking: thirdPlaced
  });
}
