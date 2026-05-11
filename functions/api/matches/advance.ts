import { getDb } from "../db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);
  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const all = await db.prepare(`
    SELECT id, stage, match_label, home_score, away_score, played,
           home_team_id, away_team_id, feeder_1_id, feeder_2_id
    FROM matches WHERE stage != 'group' ORDER BY id
  `).all();

  const map = new Map<number, any>();
  for (const m of all.results) map.set(m.id, m);

  const updates: { id: number; home_team_id: number | null; away_team_id: number | null }[] = [];

  for (const m of all.results) {
    if (!m.feeder_1_id && !m.feeder_2_id) continue;

    const f1 = map.get(m.feeder_1_id);
    const f2 = map.get(m.feeder_2_id);
    if (!f1 || !f2) continue;

    const f1Home = f1.home_score, f1Away = f1.away_score;
    const f2Home = f2.home_score, f2Away = f2.away_score;

    const f1HasResult = f1Home != null && f1Away != null;
    const f2HasResult = f2Home != null && f2Away != null;

    let homeId: number | null = null;
    let awayId: number | null = null;

    if (f1HasResult) {
      const f1Winner = f1Home > f1Away ? f1.home_team_id : (f1Away > f1Home ? f1.away_team_id : null);
      const f1Loser = f1Home > f1Away ? f1.away_team_id : (f1Away > f1Home ? f1.home_team_id : null);
      homeId = m.stage === 'third_place' ? f1Loser : f1Winner;
    }

    if (f2HasResult) {
      const f2Winner = f2Home > f2Away ? f2.home_team_id : (f2Away > f2Home ? f2.away_team_id : null);
      const f2Loser = f2Home > f2Away ? f2.away_team_id : (f2Away > f2Home ? f2.home_team_id : null);
      awayId = m.stage === 'third_place' ? f2Loser : f2Winner;
    }

    if (homeId === m.home_team_id && awayId === m.away_team_id) continue;

    updates.push({ id: m.id, home_team_id: homeId, away_team_id: awayId });
  }

  const stmt = db.prepare("UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?");
  await db.batch(updates.map(u => stmt.bind(u.home_team_id, u.away_team_id, u.id)));

  return Response.json({ advanced: updates.length });
}