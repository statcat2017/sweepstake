import { getDb, isDrawLocked } from "./db";
import { sortByPointsGDGoals } from "./sync/standings-helper";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (!(await isDrawLocked(db))) {
    return Response.json({ drawn: false, standings: [], participants: [], groupFixtures: [] });
  }

  const participantsRaw = await db.prepare(`
    SELECT p.id, p.name
    FROM participants p
    ORDER BY p.name
  `).all();

  const teamsData = await db.prepare(`
    SELECT
      t.id, t.name, t.group_letter, t.flag_emoji, t.eliminated,
      pt.participant_id, pt.bonus, pt.pot
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

    thirdPlaced.push(teams[2]);
  }

  thirdPlaced.sort(sortByPointsGDGoals);
  thirdPlaced.forEach((team: any, idx: number) => {
    team.third_rank = idx + 1;
    const groupComplete = (groups[team.group_letter] || []).every((t: any) => t.played >= 3);
    if (groupComplete) {
      const finalStatus = idx < 8 ? "qualified" : "eliminated";
      team.status = finalStatus;
      teamStatus[team.team_id] = finalStatus;
    }
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

  const groupFixturesRaw = await db.prepare(`
    SELECT
      m.id, m.group_letter, m.home_score, m.away_score, m.played, m.kickoff_at,
      ht.name as home_team, ht.flag_emoji as home_flag,
      at.name as away_team, at.flag_emoji as away_flag
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    WHERE m.stage = 'group'
    ORDER BY m.group_letter, m.kickoff_at IS NULL, datetime(m.kickoff_at), m.id
  `).all();

  const knockoutMatchesRaw = await db.prepare(`
    SELECT
      m.id, m.stage, m.match_label, m.home_score, m.away_score, m.played,
      m.feeder_1_id, m.feeder_2_id,
      ht.name as home_team, ht.flag_emoji as home_flag, ht.id as home_team_id,
      at.name as away_team, at.flag_emoji as away_flag, at.id as away_team_id
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.stage != 'group'
    ORDER BY m.id
  `).all();

  const knockoutMatches = knockoutMatchesRaw.results;

  const flattened = Object.values(groups).flat();

  const mostConceded = flattened.reduce((worst: any, team: any) => {
    return (team.goals_against ?? 0) > (worst.goals_against ?? 0) ? team : worst;
  }, flattened[0] || null);

  const teamParticipantMap: Record<number, { id: number; name: string }> = {};
  for (const t of teamsData.results) {
    if (t.participant_id) {
      teamParticipantMap[t.id] = { id: t.participant_id, name: participants.find((p: any) => p.id === t.participant_id)?.name || 'Unknown' };
    }
  }

  const h2hMatchesRaw = await db.prepare(`
    SELECT
      m.id, m.home_score, m.away_score, m.played, m.kickoff_at,
      ht.id as home_team_id, ht.name as home_team, ht.flag_emoji as home_flag,
      at.id as away_team_id, at.name as away_team, at.flag_emoji as away_flag
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    WHERE m.stage = 'group'
    ORDER BY m.kickoff_at IS NULL, datetime(m.kickoff_at), m.id
  `).all();

  const h2hStats: Record<number, { played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_difference: number; points: number; name: string }> = {};
  for (const p of participants) {
    h2hStats[p.id] = { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0, name: p.name };
  }

  const h2hUpcoming: any[] = [];
  const h2hRecent: any[] = [];

  for (const m of h2hMatchesRaw.results) {
    const homeOwner = teamParticipantMap[m.home_team_id];
    const awayOwner = teamParticipantMap[m.away_team_id];

    if (!homeOwner || !awayOwner) continue;

    if (m.played) {
      h2hRecent.push({
        id: m.id, kickoff_at: m.kickoff_at,
        home_participant: homeOwner.name, away_participant: awayOwner.name,
        home_team: m.home_team, away_team: m.away_team,
        home_flag: m.home_flag, away_flag: m.away_flag,
        home_score: m.home_score, away_score: m.away_score,
      });

      if (homeOwner.id !== awayOwner.id) {
        const homeWin = m.home_score > m.away_score;
        const awayWin = m.away_score > m.home_score;
        const draw = m.home_score === m.away_score;

        h2hStats[homeOwner.id].played++;
        h2hStats[homeOwner.id].goals_for += m.home_score;
        h2hStats[homeOwner.id].goals_against += m.away_score;
        if (homeWin) { h2hStats[homeOwner.id].won++; h2hStats[homeOwner.id].points += 3; }
        else if (draw) { h2hStats[homeOwner.id].drawn++; h2hStats[homeOwner.id].points += 1; }
        else { h2hStats[homeOwner.id].lost++; }

        h2hStats[awayOwner.id].played++;
        h2hStats[awayOwner.id].goals_for += m.away_score;
        h2hStats[awayOwner.id].goals_against += m.home_score;
        if (awayWin) { h2hStats[awayOwner.id].won++; h2hStats[awayOwner.id].points += 3; }
        else if (draw) { h2hStats[awayOwner.id].drawn++; h2hStats[awayOwner.id].points += 1; }
        else { h2hStats[awayOwner.id].lost++; }
      }
    } else {
      h2hUpcoming.push({
        id: m.id, kickoff_at: m.kickoff_at,
        home_participant: homeOwner.name, away_participant: awayOwner.name,
        home_team: m.home_team, away_team: m.away_team,
        home_flag: m.home_flag, away_flag: m.away_flag,
      });
    }
  }

  const h2hTable = Object.values(h2hStats).map((s: any) => {
    s.goal_difference = s.goals_for - s.goals_against;
    return s;
  }).sort((a: any, b: any) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for || a.name.localeCompare(b.name));
  h2hTable.forEach((r: any, i: number) => { r.position = i + 1; });

  h2hRecent.reverse();

  return Response.json({
    drawn: true,
    participants,
    teams,
    groupFixtures: groupFixturesRaw.results,
    groupStandings: flattened,
    thirdPlaceRanking: thirdPlaced,
    knockoutMatches,
    mostConceded: mostConceded ? {
      name: mostConceded.team_name,
      flag_emoji: mostConceded.flag_emoji,
      goals_against: mostConceded.goals_against ?? 0,
      played: mostConceded.played ?? 0
    } : null,
    headToHead: {
      table: h2hTable,
      upcomingFixtures: h2hUpcoming,
      recentResults: h2hRecent,
    }
  });
}
