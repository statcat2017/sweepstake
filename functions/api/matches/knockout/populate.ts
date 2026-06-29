import { getDb, getGroupStandingsRows } from "../../db";
import { requireAuth } from "../../auth";
import { assignR32TeamsFromFixtures, assignR32TeamsFromQualified, buildTeamResolver, fetchFixturesForDates, getNearbyUtcDates } from "../../sync/r32-populate";
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

    const dates = getNearbyUtcDates();
    const fixtures = await fetchFixturesForDates(apiKey, dates);

    if (fixtures.length > 0) {
      const resolverErrors: string[] = [];
      const resolveTeam = await buildTeamResolver(db, resolverErrors);
      const result = await assignR32TeamsFromFixtures(db, fixtures, qualified, resolveTeam);

      if (result.assigned > 0 || result.skipped === 0) {
        return Response.json({
          populated: true,
          source: "api",
          fixture_dates: dates,
          fixtures_fetched: fixtures.length,
          ...result,
          errors: [...resolverErrors, ...result.errors],
        });
      }
    }

    const fallback = await assignR32TeamsFromQualified(db, qualified);
    return Response.json({
      populated: true,
      source: "standings",
      fixture_dates: dates,
      fixtures_fetched: fixtures.length,
      ...fallback,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Populate failed: ${msg}` }, { status: 500 });
  }
}
