import { getDb, getGroupStandingsRows } from "../../db";
import { requireAuth } from "../../auth";
import { assignR32TeamsFromQualified } from "../../sync/r32-populate";
import { computeGroupStandings, getQualifiedTeams } from "../../sync/standings-helper";

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
    const groupRows = await getGroupStandingsRows(db);
    const qualified = getQualifiedTeams(computeGroupStandings(groupRows));
    if (!qualified) {
      return Response.json({ error: "Group stage is not complete yet." }, { status: 409 });
    }

    const result = await assignR32TeamsFromQualified(db, qualified);
    return Response.json({
      populated: true,
      source: "wikipedia",
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Populate failed: ${msg}` }, { status: 500 });
  }
}
