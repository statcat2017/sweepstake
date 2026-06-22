import { getDb, enableForeignKeys } from "./db";
import { requireAuth } from "./auth";
import { parseJsonBody, validateScores, validateId } from "./shared/validation";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "GET") {
    const matches = await db.prepare(`
      SELECT
        m.id, m.stage, m.match_label, m.group_letter, m.home_score, m.away_score, m.played,
        m.kickoff_at,
        m.feeder_1_id, m.feeder_2_id,
        ht.name as home_team, ht.flag_emoji as home_flag,
        at.name as away_team, at.flag_emoji as away_flag,
        ht.id as home_team_id, at.id as away_team_id
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      ORDER BY m.stage != 'group', m.kickoff_at IS NULL, datetime(m.kickoff_at), m.group_letter, m.id
    `).all();

    return Response.json({ matches: matches.results });
  }

  if (context.request.method === "PUT") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;

    await enableForeignKeys(db);

    const parsed = await parseJsonBody(context.request);
    if (parsed instanceof Response) return parsed;
    const body = parsed.data;

    const idResult = validateId(body);
    if (idResult instanceof Response) return idResult;

    const scoreResult = validateScores(body.home_score, body.away_score);
    if (scoreResult instanceof Response) return scoreResult;

    const { home, away } = scoreResult;
    const played = body.home_score !== undefined && body.home_score !== null ? 1 : 0;

    await db.prepare(`
      UPDATE matches SET home_score = ?, away_score = ?, played = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(home, away, played, idResult).run();

    return Response.json({ updated: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
