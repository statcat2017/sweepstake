import { getDb } from "../db";

function sortByPointsGDGoals(a: any, b: any) {
  const ptsA = a.pts ?? 0;
  const ptsB = b.pts ?? 0;
  if (ptsB !== ptsA) return ptsB - ptsA;
  const gdA = (a.gf ?? 0) - (a.ga ?? 0);
  const gdB = (b.gf ?? 0) - (b.ga ?? 0);
  if (gdB !== gdA) return gdB - gdA;
  return (b.gf ?? 0) - (a.gf ?? 0);
}

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "POST") {
    return seedKnockout(db);
  }

  if (context.request.method === "GET") {
    return getBracket(db);
  }

  if (context.request.method === "PUT") {
    return updateKnockoutMatch(db, await context.request.json());
  }

  return new Response("Method not allowed", { status: 405 });
}

async function seedKnockout(db: D1Database) {
  // Clear existing knockout matches
  await db.prepare("DELETE FROM matches WHERE stage != 'group'").run();

  // Build bracket: R32 (16) -> R16 (8) -> QF (4) -> SF (2) -> Final + 3rd
  // First pass: insert R32 matches, get their IDs
  const r32Inserts = [];
  for (let i = 1; i <= 16; i++) {
    r32Inserts.push(db.prepare(
      "INSERT INTO matches (stage, match_label) VALUES ('round_of_32', ?)"
    ).bind(`R32-${String(i).padStart(2, '0')}`));
  }

  const r32Results = await db.batch(r32Inserts);
  const r32Ids = r32Results.map(r => Number(r.meta.last_row_id));
  const m = r32Ids;

  // R16: each feeds from two consecutive R32 matches
  const r16Pairs = [
    [m[0], m[1]], [m[2], m[3]], [m[4], m[5]], [m[6], m[7]],
    [m[8], m[9]], [m[10], m[11]], [m[12], m[13]], [m[14], m[15]]
  ];

  const r16Inserts = r16Pairs.map(([f1, f2], i) =>
    db.prepare(
      "INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('round_of_16', ?, ?, ?)"
    ).bind(`R16-${String(i + 1).padStart(2, '0')}`, f1, f2)
  );

  const r16Results = await db.batch(r16Inserts);
  const r16Ids = r16Results.map(r => Number(r.meta.last_row_id));

  // QF: each feeds from two consecutive R16 matches
  const qfPairs = [
    [r16Ids[0], r16Ids[1]], [r16Ids[2], r16Ids[3]],
    [r16Ids[4], r16Ids[5]], [r16Ids[6], r16Ids[7]]
  ];

  const qfInserts = qfPairs.map(([f1, f2], i) =>
    db.prepare(
      "INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('quarter_final', ?, ?, ?)"
    ).bind(`QF-${i + 1}`, f1, f2)
  );

  const qfResults = await db.batch(qfInserts);
  const qfIds = qfResults.map(r => Number(r.meta.last_row_id));

  // SF: each feeds from two consecutive QF matches
  const sfInserts = [
    db.prepare("INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('semi_final', 'SF-1', ?, ?)").bind(qfIds[0], qfIds[1]),
    db.prepare("INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('semi_final', 'SF-2', ?, ?)").bind(qfIds[2], qfIds[3])
  ];

  const sfResults = await db.batch(sfInserts);
  const sfIds = sfResults.map(r => Number(r.meta.last_row_id));

  // Final feeds from both SFs
  await db.prepare("INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('final', 'Final', ?, ?)").bind(sfIds[0], sfIds[1]).run();

  // Third place also feeds from both SFs (same as final but different label)
  await db.prepare("INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES ('third_place', '3rd Place', ?, ?)").bind(sfIds[0], sfIds[1]).run();

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

  // Determine which teams are eligible for R32 (qualified from groups)
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