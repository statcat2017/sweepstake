import { getDb } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const db = getDb(context.env);
  const teams = await db.prepare("SELECT id, name, group_letter, flag_emoji, fifa_rank FROM teams ORDER BY group_letter, name").all();
  return Response.json({ teams: teams.results });
}
