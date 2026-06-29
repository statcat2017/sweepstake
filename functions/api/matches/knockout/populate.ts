import { getDb, getGroupStandingsRows } from "../../db";
import { requireAuth } from "../../auth";
import { assignR32TeamsFromFixtures, buildTeamResolver } from "../../sync/r32-populate";
import { computeGroupStandings, getQualifiedTeams } from "../../sync/standings-helper";

interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  FOOTBALL_API_KEY?: string;
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = requireAuth(context.request, context.env);
  if (auth) return auth;

  const apiKey = context.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "FOOTBALL_API_KEY not configured on server." }, { status: 500 });
  }

  try {
    const groupRows = await getGroupStandingsRows(db);
    const qualified = getQualifiedTeams(computeGroupStandings(groupRows));
    if (!qualified) {
      return Response.json({ error: "Group stage is not complete yet." }, { status: 409 });
    }

    const resp = await fetch("https://v3.football.api-sports.io/fixtures?league=1&season=2026", {
      headers: { "x-apisports-key": apiKey },
    });
    if (!resp.ok) {
      const text = await resp.text();
      return Response.json({ error: `API-Football returned ${resp.status}: ${text.slice(0, 500)}` }, { status: 502 });
    }

    const data: any = await resp.json();
    if (!data.response || !Array.isArray(data.response)) {
      return Response.json({ error: "Unexpected API response structure." }, { status: 502 });
    }

    const resolverErrors: string[] = [];
    const resolveTeam = await buildTeamResolver(db, resolverErrors);
    const result = await assignR32TeamsFromFixtures(db, data.response, qualified, resolveTeam);

    return Response.json({ populated: true, ...result, errors: [...resolverErrors, ...result.errors] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Populate failed: ${msg}` }, { status: 500 });
  }
}
