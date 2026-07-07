import { getDb, getGroupStandingsRows } from "../db";
import { requireAuth } from "../auth";
import { seedBracket } from "../sync/bracket-paths";
import { rankGroup2026 } from "../sync/standings-helper";
import { parseJsonBody, validateScores, validateId } from "../shared/validation";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "POST") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;
    return seedKnockout(db);
  }

  if (context.request.method === "GET") {
    return getBracket(db);
  }

  if (context.request.method === "PUT") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;
    const parsed = await parseJsonBody(context.request);
    if (parsed instanceof Response) return parsed;
    return updateKnockoutMatch(db, parsed.data);
  }

  return new Response("Method not allowed", { status: 405 });
}

async function seedKnockout(db: D1Database) {
  await seedBracket(db);
  return Response.json({ seeded: 32 });
}

async function getBracket(db: D1Database) {
  const matches = await db.prepare(`
    SELECT
      m.id, m.stage, m.match_label, m.home_score, m.away_score, m.played,
      m.feeder_1_id, m.feeder_2_id, m.winner_team_id,
      ht.name as home_team, ht.flag_emoji as home_flag,
      at.name as away_team, at.flag_emoji as away_flag,
      ht.id as home_team_id, at.id as away_team_id
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.stage != 'group'
    ORDER BY m.id
  `).all();

  const groupsRes = await getGroupStandingsRows(db);

  const groupMatchesRes = await db.prepare(`
    SELECT m.group_letter, m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.played
    FROM matches m
    WHERE m.stage = 'group'
  `).all();

  const groupMatchesByLetter: Record<string, any[]> = {};
  for (const m of groupMatchesRes.results) {
    if (!groupMatchesByLetter[m.group_letter]) groupMatchesByLetter[m.group_letter] = [];
    groupMatchesByLetter[m.group_letter].push(m);
  }

  const groups: Record<string, any[]> = {};
  for (const row of groupsRes) {
    if (!groups[row.group_letter]) groups[row.group_letter] = [];
    groups[row.group_letter].push(row);
  }

  for (const letter of Object.keys(groups)) {
    const gMatches = groupMatchesByLetter[letter] || [];
    groups[letter] = rankGroup2026(groups[letter], gMatches);
  }

  const groupWinners: any[] = [];
  const groupRunnersUp: any[] = [];
  const thirdPlaced: any[] = [];

  for (const letter of Object.keys(groups).sort()) {
    const g = groups[letter];
    if (g[0]) groupWinners.push({ ...g[0], position: 1 });
    if (g[1]) groupRunnersUp.push({ ...g[1], position: 2 });
    if (g[2]) thirdPlaced.push({ ...g[2], position: 3 });
  }

  thirdPlaced.sort((a: any, b: any) => {
    if (b.points !== a.points) return b.points - a.points;
    const aGD = a.goals_for - a.goals_against;
    const bGD = b.goals_for - b.goals_against;
    if (bGD !== aGD) return bGD - aGD;
    return b.goals_for - a.goals_for;
  });
  const bestThird = thirdPlaced.slice(0, 8);

  const eligibleTeams = [
    ...groupWinners.map(t => ({ ...t, qualifier: 'Group Winner' })),
    ...groupRunnersUp.map(t => ({ ...t, qualifier: 'Runner-Up' })),
    ...bestThird.map(t => ({ ...t, qualifier: '3rd Place' }))
  ];

  return Response.json({
    matches: matches.results,
    eligibleTeams: eligibleTeams.sort((a, b) => {
      if (a.group_letter !== b.group_letter) return a.group_letter.localeCompare(b.group_letter);
      return (a.position || 0) - (b.position || 0);
    })
  });
}

async function updateKnockoutMatch(db: D1Database, body: any) {
  const idResult = validateId(body);
  if (idResult instanceof Response) return idResult;
  const id = idResult;

  const updates: string[] = [];
  const values: any[] = [];

  if (body.home_team_id !== undefined) {
    updates.push("home_team_id = ?");
    values.push(body.home_team_id || null);
  }
  if (body.away_team_id !== undefined) {
    updates.push("away_team_id = ?");
    values.push(body.away_team_id || null);
  }
  if (body.winner_team_id !== undefined) {
    updates.push("winner_team_id = ?");
    values.push(body.winner_team_id || null);
  }

  const hasScoreUpdate = body.home_score !== undefined || body.away_score !== undefined;
  if (hasScoreUpdate) {
    const scoreResult = validateScores(body.home_score, body.away_score);
    if (scoreResult instanceof Response) return scoreResult;
    const { home, away } = scoreResult;
    updates.push("home_score = ?");
    values.push(body.home_score !== undefined && body.home_score !== null ? home : null);
    updates.push("away_score = ?");
    values.push(body.away_score !== undefined && body.away_score !== null ? away : null);
    updates.push("played = ?");
    values.push(body.home_score !== undefined && body.home_score !== null ? 1 : 0);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await db.prepare(`UPDATE matches SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();

  return Response.json({ updated: true });
}
