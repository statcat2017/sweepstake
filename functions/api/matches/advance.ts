import { getDb, enableForeignKeys } from "../db";
import { requireAuth } from "../auth";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);
  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = requireAuth(context.request, context.env);
  if (auth) return auth;

  await enableForeignKeys(db);

  const all = await db.prepare(`
    SELECT id, stage, match_label, home_score, away_score, played,
           home_team_id, away_team_id, winner_team_id, feeder_1_id, feeder_2_id
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

    function winnerLoser(f: any): { winner: number | null; loser: number | null } {
      if (f.home_score > f.away_score) return { winner: f.home_team_id, loser: f.away_team_id };
      if (f.away_score > f.home_score) return { winner: f.away_team_id, loser: f.home_team_id };
      if (f.winner_team_id) {
        const loser = f.winner_team_id === f.home_team_id ? f.away_team_id : f.home_team_id;
        return { winner: f.winner_team_id, loser };
      }
      return { winner: null, loser: null };
    }

    if (f1HasResult) {
      const r1 = winnerLoser(f1);
      homeId = m.stage === 'third_place' ? r1.loser : r1.winner;
    }

    if (f2HasResult) {
      const r2 = winnerLoser(f2);
      awayId = m.stage === 'third_place' ? r2.loser : r2.winner;
    }

    if (homeId === m.home_team_id && awayId === m.away_team_id) continue;

    updates.push({ id: m.id, home_team_id: homeId, away_team_id: awayId });
  }

  const stmt = db.prepare("UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?");
  await db.batch(updates.map(u => stmt.bind(u.home_team_id, u.away_team_id, u.id)));

  return Response.json({ advanced: updates.length });
}