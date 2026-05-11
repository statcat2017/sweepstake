import { getDb } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "GET") {
    const matches = await db.prepare(`
      SELECT
        m.id, m.stage, m.match_label, m.group_letter, m.home_score, m.away_score, m.played,
        ht.name as home_team, ht.flag_emoji as home_flag,
        at.name as away_team, at.flag_emoji as away_flag,
        ht.id as home_team_id, at.id as away_team_id
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      ORDER BY m.id
    `).all();

    return Response.json({ matches: matches.results });
  }

  if (context.request.method === "PUT") {
    const body = await context.request.json() as {
      id: number;
      home_score: number | null;
      away_score: number | null;
    };

    if (!body.id) {
      return Response.json({ error: "Match ID is required." }, { status: 400 });
    }

    const played = body.home_score !== null && body.away_score !== null ? 1 : 0;

    await db.prepare(`
      UPDATE matches SET home_score = ?, away_score = ?, played = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(body.home_score, body.away_score, played, body.id).run();

    return Response.json({ updated: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
