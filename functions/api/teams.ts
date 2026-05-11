import { getDb } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);
  const teams = await db.prepare("SELECT id, name, group_letter, flag_emoji FROM teams ORDER BY group_letter, name").all();
  return Response.json({ teams: teams.results });
}
