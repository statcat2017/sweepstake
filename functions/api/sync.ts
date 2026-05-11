import { getDb } from "./db";
import { requireAuth } from "./auth";
import { apiNameToDbName, dbNameToApiName } from "./sync/team-mapping";
import { getR32Slots, getBracketDAG } from "./sync/bracket-paths";
import { computeGroupStandings, getQualifiedTeams, resolveTeamSource, GroupStandingRow } from "./sync/standings-helper";

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
    return await runSync(db, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Sync failed: ${msg}` }, { status: 500 });
  }
}

interface SyncReport {
  fixtures_fetched: number;
  group_scores_updated: number;
  group_scores_skipped: number;
  knockout_scores_updated: number;
  knockout_scores_skipped: number;
  r32_teams_assigned: number;
  r16_advanced: number;
  qf_advanced: number;
  sf_advanced: number;
  final_advanced: number;
  errors: string[];
}

async function runSync(db: D1Database, apiKey: string): Promise<Response> {
  const report: SyncReport = {
    fixtures_fetched: 0,
    group_scores_updated: 0,
    group_scores_skipped: 0,
    knockout_scores_updated: 0,
    knockout_scores_skipped: 0,
    r32_teams_assigned: 0,
    r16_advanced: 0,
    qf_advanced: 0,
    sf_advanced: 0,
    final_advanced: 0,
    errors: [],
  };

  const url = "https://v3.football.api-sports.io/fixtures?league=1&season=2026";
  const resp = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
  });

  if (!resp.ok) {
    const text = await resp.text();
    return Response.json({ error: `API-Football returned ${resp.status}: ${text.slice(0, 500)}` }, { status: 502 });
  }

  const data: any = await resp.json();
  if (!data.response || !Array.isArray(data.response)) {
    return Response.json({ error: `Unexpected API response structure.` }, { status: 502 });
  }

  const fixtures: any[] = data.response;
  report.fixtures_fetched = fixtures.length;

  const finishedStatuses = new Set(["FT", "AET", "PEN"]);

  const allMatches = await db.prepare(`
    SELECT m.id, m.stage, m.match_label, m.group_letter, m.home_score, m.away_score, m.played,
           m.home_team_id, m.away_team_id
    FROM matches m
    ORDER BY m.id
  `).all<any>();

  const dbMatchByTeamPair = new Map<string, any[]>();
  for (const m of allMatches.results) {
    if (m.home_team_id && m.away_team_id) {
      const key = `${m.home_team_id}-${m.away_team_id}`;
      if (!dbMatchByTeamPair.has(key)) dbMatchByTeamPair.set(key, []);
      dbMatchByTeamPair.get(key)!.push(m);
    }
  }

  const teams = await db.prepare("SELECT id, name FROM teams").all<any>();
  const nameToDbId = new Map<string, number>();
  for (const t of teams.results) {
    nameToDbId.set(t.name, t.id);
    nameToDbId.set(dbNameToApiName(t.name), t.id);
  }

  for (const fixture of fixtures) {
    const status = fixture.fixture?.status?.short;
    if (!status || !finishedStatuses.has(status)) continue;

    const apiHomeName: string | undefined = fixture.teams?.home?.name;
    const apiAwayName: string | undefined = fixture.teams?.away?.name;
    if (!apiHomeName || !apiAwayName) continue;

    const homeScore: number | null = fixture.goals?.home;
    const awayScore: number | null = fixture.goals?.away;
    if (homeScore === null || awayScore === null) continue;

    const dbHomeName = apiNameToDbName(apiHomeName);
    const dbAwayName = apiNameToDbName(apiAwayName);
    if (!dbHomeName || !dbAwayName) {
      report.errors.push(`Unmapped team: '${apiHomeName}' or '${apiAwayName}'`);
      continue;
    }

    const homeId = nameToDbId.get(dbHomeName);
    const awayId = nameToDbId.get(dbAwayName);
    if (!homeId || !awayId) {
      report.errors.push(`Team not in DB: '${dbHomeName}' or '${dbAwayName}'`);
      continue;
    }

    const key = `${homeId}-${awayId}`;
    const candidates = dbMatchByTeamPair.get(key) || [];

    const round = (fixture.league?.round || "") as string;
    const isGroup = round.startsWith("Group");

    let match: any | undefined;
    for (const c of candidates) {
      if (isGroup && c.stage === "group") {
        match = c;
        break;
      }
      if (!isGroup && c.stage !== "group") {
        match = c;
        break;
      }
    }

    if (!match) continue;

    if (match.home_score === homeScore && match.away_score === awayScore && match.played === 1) {
      if (isGroup) report.group_scores_skipped++;
      else report.knockout_scores_skipped++;
      continue;
    }

    const kickoffAt: string | null = fixture.fixture?.date || null;
    const apiFixtureId: number | null = fixture.fixture?.id || null;

    await db.prepare(`
      UPDATE matches
      SET home_score = ?, away_score = ?, played = 1,
          kickoff_at = COALESCE(?, kickoff_at),
          api_fixture_id = COALESCE(?, api_fixture_id),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(homeScore, awayScore, kickoffAt, apiFixtureId, match.id).run();

    if (isGroup) report.group_scores_updated++;
    else report.knockout_scores_updated++;
  }

  const groupRows = await db.prepare(`
    SELECT
      t.group_letter, t.id as team_id, t.name as team_name, t.flag_emoji as flag_emoji,
      COALESCE(SUM(CASE
        WHEN m.home_team_id = t.id THEN
          CASE WHEN m.home_score > m.away_score THEN 3 WHEN m.home_score = m.away_score THEN 1 ELSE 0 END
        WHEN m.away_team_id = t.id THEN
          CASE WHEN m.away_score > m.home_score THEN 3 WHEN m.away_score = m.home_score THEN 1 ELSE 0 END
        ELSE 0
      END), 0) as points,
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score WHEN m.away_team_id = t.id THEN m.away_score ELSE 0 END), 0) as goals_for,
      COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.away_score WHEN m.away_team_id = t.id THEN m.home_score ELSE 0 END), 0) as goals_against,
      COALESCE(SUM(CASE WHEN (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.played = 1 THEN 1 ELSE 0 END), 0) as played
    FROM teams t
    LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.stage = 'group'
    GROUP BY t.id
  `).all<any>();

  const groups = computeGroupStandings(groupRows.results);
  const qualified = getQualifiedTeams(groups);

  if (qualified) {
    const r32Slots = getR32Slots();
    const r32MatchesInDb = allMatches.results
      .filter(m => m.stage === "round_of_32")
      .sort((a, b) => (a.id || 0) - (b.id || 0));

    for (let i = 0; i < r32Slots.length && i < r32MatchesInDb.length; i++) {
      const slot = r32Slots[i];
      const dbMatch = r32MatchesInDb[i];

      const homeTeamId = resolveTeamSource(slot.homeSource as any, qualified);
      const awayTeamId = resolveTeamSource(slot.awaySource as any, qualified);

      if (homeTeamId && awayTeamId) {
        if (dbMatch.home_team_id !== homeTeamId || dbMatch.away_team_id !== awayTeamId) {
          await db.prepare(`
            UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?
          `).bind(homeTeamId, awayTeamId, dbMatch.id).run();
          report.r32_teams_assigned++;
        }
      }
    }

    const bracketMatches = await db.prepare(`
      SELECT id, stage, match_label, home_score, away_score, played,
             home_team_id, away_team_id, feeder_1_id, feeder_2_id
      FROM matches WHERE stage != 'group' ORDER BY id
    `).all<any>();

    const labelToMatch = new Map<string, any>();
    for (const m of bracketMatches.results) {
      if (m.match_label) {
        labelToMatch.set(m.match_label, m);
      }
    }

    const dag = getBracketDAG();
    for (const link of dag) {
      const child = labelToMatch.get(link.childLabel);
      const p1 = labelToMatch.get(link.parent1Label);
      const p2 = labelToMatch.get(link.parent2Label);
      if (!child || !p1 || !p2) continue;

      const p1Done = p1.home_score != null && p1.away_score != null && p1.played === 1;
      const p2Done = p2.home_score != null && p2.away_score != null && p2.played === 1;
      if (!p1Done || !p2Done) continue;

      const isThird = child.stage === "third_place";

      const p1Winner = p1.home_score > p1.away_score ? p1.home_team_id : p1.away_team_id;
      const p1Loser = p1.home_score > p1.away_score ? p1.away_team_id : p1.home_team_id;
      const p2Winner = p2.home_score > p2.away_score ? p2.home_team_id : p2.away_team_id;
      const p2Loser = p2.home_score > p2.away_score ? p2.away_team_id : p2.home_team_id;

      const homeId = isThird ? p1Loser : p1Winner;
      const awayId = isThird ? p2Loser : p2Winner;

      if (homeId !== child.home_team_id || awayId !== child.away_team_id) {
        await db.prepare(`
          UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(homeId, awayId, child.id).run();

        if (child.stage === "round_of_16") report.r16_advanced++;
        else if (child.stage === "quarter_final") report.qf_advanced++;
        else if (child.stage === "semi_final") report.sf_advanced++;
        else report.final_advanced++;
      }
    }
  }

  return Response.json({ synced: true, ...report });
}
