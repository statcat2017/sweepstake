import { getDb, getGroupStandingsRows, enableForeignKeys } from "./db";
import { requireAuth } from "./auth";
import { apiNameToDbName, dbNameToApiName } from "./sync/team-mapping";
import { getBracketDAG, getR32Slots } from "./sync/bracket-paths";
import { computeGroupStandings, getQualifiedTeams, resolveTeamSource } from "./sync/standings-helper";

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

  await enableForeignKeys(db);

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
  penalty_winners_set: number;
  r32_teams_assigned: number;
  r16_advanced: number;
  qf_advanced: number;
  sf_advanced: number;
  final_advanced: number;
  errors: string[];
}

async function loadMatchMap(db: D1Database): Promise<{ matches: any[]; byTeamPair: Map<string, any[]> }> {
  const allMatches = await db.prepare(`
    SELECT m.id, m.stage, m.match_label, m.group_letter, m.home_score, m.away_score, m.played,
           m.home_team_id, m.away_team_id, m.winner_team_id
    FROM matches m
    ORDER BY m.id
  `).all<any>();

  const byTeamPair = new Map<string, any[]>();
  for (const m of allMatches.results) {
    if (m.home_team_id && m.away_team_id) {
      const key = `${m.home_team_id}-${m.away_team_id}`;
      if (!byTeamPair.has(key)) byTeamPair.set(key, []);
      byTeamPair.get(key)!.push(m);
    }
  }
  return { matches: allMatches.results, byTeamPair };
}

async function runSync(db: D1Database, apiKey: string): Promise<Response> {
  const report: SyncReport = {
    fixtures_fetched: 0,
    group_scores_updated: 0,
    group_scores_skipped: 0,
    knockout_scores_updated: 0,
    knockout_scores_skipped: 0,
    penalty_winners_set: 0,
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

  const teams = await db.prepare("SELECT id, name FROM teams").all<any>();
  const nameToDbId = new Map<string, number>();
  for (const t of teams.results) {
    nameToDbId.set(t.name, t.id);
    nameToDbId.set(dbNameToApiName(t.name), t.id);
  }

  function resolveTeam(apiName: string): number | null {
    const dbName = apiNameToDbName(apiName);
    if (!dbName) return null;
    const id = nameToDbId.get(dbName);
    if (id) return id;
    report.errors.push(`Team not in DB: '${apiName}'`);
    return null;
  }

  async function processFixture(fixture: any, state: { byTeamPair: Map<string, any[]> }): Promise<number> {
    const status = fixture.fixture?.status?.short;
    if (!status || !finishedStatuses.has(status)) return 0;

    const apiHomeName: string | undefined = fixture.teams?.home?.name;
    const apiAwayName: string | undefined = fixture.teams?.away?.name;
    if (!apiHomeName || !apiAwayName) return 0;

    const homeScore: number | null = fixture.goals?.home;
    const awayScore: number | null = fixture.goals?.away;
    if (homeScore === null || awayScore === null) return 0;

    const homeId = resolveTeam(apiHomeName);
    const awayId = resolveTeam(apiAwayName);
    if (!homeId || !awayId) return 0;

    const round = (fixture.league?.round || "") as string;
    const isGroup = round.startsWith("Group");
    const isPenalty = status === "PEN";
    const apiFixtureId: number | null = fixture.fixture?.id || null;

    const key = `${homeId}-${awayId}`;
    const candidates = state.byTeamPair.get(key) || [];
    let match: any | undefined;
    for (const c of candidates) {
      if (isGroup && c.stage === "group") { match = c; break; }
      if (!isGroup && c.stage !== "group") { match = c; break; }
    }
    if (!match) return 0;

    const scoreChanged = match.home_score !== homeScore || match.away_score !== awayScore || !match.played;

    let winnerTeamId: number | null = null;
    if (isPenalty && !isGroup) {
      if (fixture.teams?.home?.winner === true) winnerTeamId = homeId;
      else if (fixture.teams?.away?.winner === true) winnerTeamId = awayId;
    }

    if (!scoreChanged && (!winnerTeamId || match.winner_team_id === winnerTeamId)) {
      if (isGroup) report.group_scores_skipped++;
      else report.knockout_scores_skipped++;
      return 0;
    }

    await db.prepare(`
      UPDATE matches
      SET home_score = ?, away_score = ?, played = 1,
          kickoff_at = COALESCE(?, kickoff_at),
          api_fixture_id = COALESCE(?, api_fixture_id),
          winner_team_id = COALESCE(?, winner_team_id),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(homeScore, awayScore, fixture.fixture?.date || null, apiFixtureId, winnerTeamId, match.id).run();

    if (isGroup) report.group_scores_updated++;
    else report.knockout_scores_updated++;
    if (winnerTeamId && match.winner_team_id !== winnerTeamId) report.penalty_winners_set++;

    return 1;
  }

  async function tryAdvance(): Promise<number> {
    const bracketMatches = await db.prepare(`
      SELECT id, stage, match_label, home_score, away_score, played,
             home_team_id, away_team_id, winner_team_id, feeder_1_id, feeder_2_id
      FROM matches WHERE stage != 'group' ORDER BY id
    `).all<any>();

    const labelToMatch = new Map<string, any>();
    for (const m of bracketMatches.results) {
      if (m.match_label) labelToMatch.set(m.match_label, m);
    }

    let advances = 0;
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

      function getWinnerAndLoser(m: any): { winner: number | null; loser: number | null } {
        if (m.home_score > m.away_score) return { winner: m.home_team_id, loser: m.away_team_id };
        if (m.away_score > m.home_score) return { winner: m.away_team_id, loser: m.home_team_id };
        if (m.winner_team_id) {
          const loser = m.winner_team_id === m.home_team_id ? m.away_team_id : m.home_team_id;
          return { winner: m.winner_team_id, loser };
        }
        return { winner: null, loser: null };
      }

      const r1 = getWinnerAndLoser(p1);
      const r2 = getWinnerAndLoser(p2);
      if (r1.winner == null || r2.winner == null) continue;

      const homeId = isThird ? r1.loser : r1.winner;
      const awayId = isThird ? r2.loser : r2.winner;

      if (homeId !== child.home_team_id || awayId !== child.away_team_id) {
        await db.prepare(`
          UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(homeId, awayId, child.id).run();

        advances++;
        if (child.stage === "round_of_16") report.r16_advanced++;
        else if (child.stage === "quarter_final") report.qf_advanced++;
        else if (child.stage === "semi_final") report.sf_advanced++;
        else report.final_advanced++;
      }
    }

    return advances;
  }

  // ── Phase A: iterative score + advance loop ──
  const MAX_ITERATIONS = 6;
  let state = await loadMatchMap(db);

  async function runLoop(iterationCap: number) {
    for (let iter = 0; iter < iterationCap; iter++) {
      let scoreChanges = 0;
      for (const fixture of fixtures) {
        scoreChanges += await processFixture(fixture, state);
      }
      const advances = await tryAdvance();
      if (scoreChanges === 0 && advances === 0) break;
      state = await loadMatchMap(db);
    }
  }

  await runLoop(MAX_ITERATIONS);

  // ── Phase B: assign R32 teams from group standings (only when all groups complete) ──
  const groupRows = await getGroupStandingsRows(db);

  const groups = computeGroupStandings(groupRows);
  const qualified = getQualifiedTeams(groups);

  if (qualified) {
    const r32Slots = getR32Slots();
    const r32MatchesInDb = state.matches
      .filter(m => m.stage === "round_of_32")
      .sort((a, b) => (a.id || 0) - (b.id || 0));

    // ── B: match all 16 R32 slots to API fixtures by team identity ──
    // Standings provide lookup keys (winner/runner-up IDs); API fixtures
    // supply the actual team assignment for every slot.
    for (let i = 0; i < r32Slots.length && i < r32MatchesInDb.length; i++) {
      const slot = r32Slots[i];
      const dbMatch = r32MatchesInDb[i];
      if (dbMatch.home_team_id && dbMatch.away_team_id) continue;

      // Build lookup keys from standings (winners + runners-up only)
      const expectedIds: (number | null)[] = [];
      for (const src of [slot.homeSource, slot.awaySource] as any[]) {
        if (src.type !== "best-third") {
          expectedIds.push(resolveTeamSource(src, qualified));
        } else {
          expectedIds.push(null);
        }
      }

      // Find the API fixture that contains at least one expected team
      for (const fixture of fixtures) {
        const round = (fixture.league?.round || "") as string;
        if (!round.toLowerCase().includes("round of 32")) continue;

        const fHomeId = resolveTeam(fixture.teams?.home?.name);
        const fAwayId = resolveTeam(fixture.teams?.away?.name);
        if (!fHomeId || !fAwayId) continue;

        if (!expectedIds.includes(fHomeId) && !expectedIds.includes(fAwayId)) continue;

        await db.prepare(`
          UPDATE matches SET home_team_id = ?, away_team_id = ?,
          updated_at = datetime('now') WHERE id = ?
        `).bind(fHomeId, fAwayId, dbMatch.id).run();

        report.r32_teams_assigned++;
        break;
      }
    }
  }

  // ── Phase C: one more loop to catch scores for newly-assigned R32 ──
  if (report.r32_teams_assigned > 0) {
    state = await loadMatchMap(db);
    await runLoop(MAX_ITERATIONS);
  }

  return Response.json({ synced: true, ...report });
}
