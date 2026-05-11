import { getDb } from "../db";
import { requireAuth } from "../auth";
import { generateBracketSeeds } from "../sync/bracket-paths";
import { sortByPointsGDGoals } from "../sync/standings-helper";

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
    return updateKnockoutMatch(db, await context.request.json());
  }

  return new Response("Method not allowed", { status: 405 });
}

async function seedKnockout(db: D1Database) {
  await db.prepare("DELETE FROM matches WHERE stage != 'group'").run();

  const seeds = generateBracketSeeds();

  const r32Inserts = seeds.slice(0, 16).map(s =>
    db.prepare("INSERT INTO matches (stage, match_label) VALUES ('round_of_32', ?)").bind(s.matchLabel)
  );
  const r32Results = await db.batch(r32Inserts);
  const r32Ids = r32Results.map(r => Number(r.meta.last_row_id));

  const labelToId = new Map<string, number>();
  for (let i = 0; i < 16; i++) {
    labelToId.set(seeds[i].matchLabel, r32Ids[i]);
  }

  const nonR32Inserts = seeds.slice(16).map(s => {
    const f1Id = s.feeder1Label ? (labelToId.get(s.feeder1Label) ?? null) : null;
    const f2Id = s.feeder2Label ? (labelToId.get(s.feeder2Label) ?? null) : null;
    return db.prepare(
      "INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES (?, ?, ?, ?)"
    ).bind(s.stage, s.matchLabel, f1Id, f2Id);
  });

  await db.batch(nonR32Inserts);

  return Response.json({ seeded: 32 });
}

async function getBracket(db: D1Database) {
  const matches = await db.prepare(`
    SELECT
      m.id, m.stage, m.match_label, m.home_score, m.away_score, m.played,
      m.feeder_1_id, m.feeder_2_id,
      ht.name as home_team, ht.flag_emoji as home_flag,
      at.name as away_team, at.flag_emoji as away_flag,
      ht.id as home_team_id, at.id as away_team_id
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.stage != 'group'
    ORDER BY m.id
  `).all();

  const groupsRes = await db.prepare(`
    SELECT t.id, t.name, t.flag_emoji, t.group_letter,
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id AND m.home_score > m.away_score THEN 3 WHEN m.home_team_id = t.id AND m.home_score = m.away_score THEN 1 WHEN m.away_team_id = t.id AND m.away_score > m.home_score THEN 3 WHEN m.away_team_id = t.id AND m.away_score = m.home_score THEN 1 ELSE 0 END), 0) as pts,
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score WHEN m.away_team_id = t.id THEN m.away_score ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.away_score WHEN m.away_team_id = t.id THEN m.home_score ELSE 0 END), 0) as gd,
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score WHEN m.away_team_id = t.id THEN m.away_score ELSE 0 END), 0) as gf,
      COALESCE(SUM(CASE WHEN (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.played = 1 THEN 1 ELSE 0 END), 0) as played
    FROM teams t
    LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.stage = 'group'
    GROUP BY t.id
  `).all();

  const groups: Record<string, any[]> = {};
  for (const row of groupsRes.results) {
    if (!groups[row.group_letter]) groups[row.group_letter] = [];
    groups[row.group_letter].push(row);
  }

  for (const letter of Object.keys(groups)) {
    groups[letter].sort(sortByPointsGDGoals);
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

  thirdPlaced.sort(sortByPointsGDGoals);
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
  if (!body.id) {
    return Response.json({ error: "Match ID is required." }, { status: 400 });
  }

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
  if (body.home_score !== undefined) {
    updates.push("home_score = ?");
    values.push(body.home_score !== '' ? body.home_score : null);
  }
  if (body.away_score !== undefined) {
    updates.push("away_score = ?");
    values.push(body.away_score !== '' ? body.away_score : null);
  }

  if (body.home_score !== undefined && body.away_score !== undefined) {
    const h = body.home_score !== '' ? parseInt(body.home_score) : null;
    const a = body.away_score !== '' ? parseInt(body.away_score) : null;
    updates.push("played = ?");
    values.push(h !== null && a !== null ? 1 : 0);
  }

  updates.push("updated_at = datetime('now')");
  values.push(body.id);

  await db.prepare(`UPDATE matches SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();

  return Response.json({ updated: true });
}
