import { getDb } from "../../db";
import { requireAuth } from "../../auth";
import { seedBracket } from "../../sync/bracket-paths";
import { assignR32TeamsFromBracketSlots } from "../../sync/r32-populate";

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = requireAuth(context.request, context.env);
  if (auth) return auth;

  try {
    const existing = await db.prepare(
      "SELECT COUNT(*) as cnt FROM matches WHERE stage = 'round_of_32'"
    ).first<{ cnt: number }>();
    let seeded = 0;
    if (!existing || existing.cnt === 0) {
      await seedBracket(db);
      seeded = 32;
    }

    const result = await assignR32TeamsFromBracketSlots(db);
    return Response.json({
      populated: true,
      source: "wikipedia",
      seeded,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Populate failed: ${msg}` }, { status: 500 });
  }
}
