import { getDb } from "./db";
import { requireAuth } from "./auth";
import { apiNameToDbName, dbNameToApiName } from "./sync/team-mapping";
import { getBracketDAG } from "./sync/bracket-paths";
import { computeGroupStandings } from "./sync/standings-helper";

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
  penalty_winners_set: number;
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
    r32_teams_assigned: 0,
    penalty_winners_set: 0,
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

  function winnerLogic(home: number, away: number) {
    return home > away ? { winner: "home", loser: "away" } : away > home ? { winner: "away", loser: "home" } : { winner: null, loser: null };
  }

  // ── Phase 1: update existing scores ──
  let state = await loadMatchMap(db);
  const processedFixtureIds = new Set<number>();

  for (const fixture of fixtures) {
    const status = fixture.fixture?.status?.short;
    if (!status || !finishedStatuses.has(status)) continue;

    const apiHomeName: string | undefined = fixture.teams?.home?.name;
    const apiAwayName: string | undefined = fixture.teams?.away?.name;
    if (!apiHomeName || !apiAwayName) continue;

    const homeScore: number | null = fixture.goals?.home;
    const awayScore: number | null = fixture.goals?.away;
    if (homeScore === null || awayScore === null) continue;

    const homeId = resolveTeam(apiHomeName);
    const awayId = resolveTeam(apiAwayName);
    if (!homeId || !awayId) continue;

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

    if (!match) continue;

    processedFixtureIds.add(apiFixtureId ?? 0);

    const scoreChanged = match.home_score !== homeScore || match.away_score !== awayScore || !match.played;

    let winnerTeamId: number | null = null;
    if (isPenalty && !isGroup) {
      const homeWon = fixture.teams?.home?.winner === true;
      const awayWon = fixture.teams?.away?.winner === true;
      if (homeWon) winnerTeamId = homeId;
      else if (awayWon) winnerTeamId = awayId;
    }

    const kickoffAt: string | null = fixture.fixture?.date || null;

    if (scoreChanged || (winnerTeamId && match.winner_team_id !== winnerTeamId)) {
      await db.prepare(`
        UPDATE matches
        SET home_score = ?, away_score = ?, played = 1,
            kickoff_at = COALESCE(?, kickoff_at),
            api_fixture_id = COALESCE(?, api_fixture_id),
            winner_team_id = COALESCE(?, winner_team_id),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(homeScore, awayScore, kickoffAt, apiFixtureId, winnerTeamId, match.id).run();

      if (isGroup) report.group_scores_updated++;
      else report.knockout_scores_updated++;
      if (winnerTeamId && match.winner_team_id !== winnerTeamId) report.penalty_winners_set++;
    } else {
      if (isGroup) report.group_scores_skipped++;
      else report.knockout_scores_skipped++;
    }
  }

  // ── Phase 2: assign R32 teams from API fixtures ──
  const emptyR32 = state.matches.filter(m => m.stage === "round_of_32" && !m.home_team_id && !m.away_team_id);
  let r32SlotIdx = 0;

  for (const fixture of fixtures) {
    if (r32SlotIdx >= emptyR32.length) break;

    const round = (fixture.league?.round || "") as string;
    if (!round.toLowerCase().includes("round of 32")) continue;

    if (processedFixtureIds.has(fixture.fixture?.id)) continue;

    const homeScore: number | null = fixture.goals?.home;
    const awayScore: number | null = fixture.goals?.away;
    if (homeScore === null || awayScore === null) continue;

    const homeId = resolveTeam(fixture.teams?.home?.name);
    const awayId = resolveTeam(fixture.teams?.away?.name);
    if (!homeId || !awayId) continue;

    const slot = emptyR32[r32SlotIdx];
    await db.prepare("UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(homeId, awayId, slot.id).run();

    slot.home_team_id = homeId;
    slot.away_team_id = awayId;
    state.byTeamPair.set(`${homeId}-${awayId}`, [slot]);

    report.r32_teams_assigned++;
    r32SlotIdx++;
  }

  // ── Phase 3: refresh and catch KO scores for newly-assigned R32 ──
  if (r32SlotIdx > 0) {
    state = await loadMatchMap(db);

    for (const fixture of fixtures) {
      if (processedFixtureIds.has(fixture.fixture?.id)) continue;

      const status = fixture.fixture?.status?.short;
      if (!status || !finishedStatuses.has(status)) continue;

      const homeScore: number | null = fixture.goals?.home;
      const awayScore: number | null = fixture.goals?.away;
      if (homeScore === null || awayScore === null) continue;

      const homeId = resolveTeam(fixture.teams?.home?.name);
      const awayId = resolveTeam(fixture.teams?.away?.name);
      if (!homeId || !awayId) continue;

      const round = (fixture.league?.round || "") as string;
      if (round.startsWith("Group")) continue;

      const key = `${homeId}-${awayId}`;
      const candidates = state.byTeamPair.get(key) || [];
      let match: any | undefined;
      for (const c of candidates) {
        if (c.stage !== "group") { match = c; break; }
      }
      if (!match) continue;

      const scoreChanged = match.home_score !== homeScore || match.away_score !== awayScore || !match.played;

      let winnerTeamId: number | null = null;
      if (status === "PEN") {
        const homeWon = fixture.teams?.home?.winner === true;
        const awayWon = fixture.teams?.away?.winner === true;
        if (homeWon) winnerTeamId = homeId;
        else if (awayWon) winnerTeamId = awayId;
      }

      if (scoreChanged || (winnerTeamId && match.winner_team_id !== winnerTeamId)) {
        const kickoffAt: string | null = fixture.fixture?.date || null;
        const apiFixtureId: number | null = fixture.fixture?.id || null;
        await db.prepare(`
          UPDATE matches
          SET home_score = ?, away_score = ?, played = 1,
              kickoff_at = COALESCE(?, kickoff_at),
              api_fixture_id = COALESCE(?, api_fixture_id),
              winner_team_id = COALESCE(?, winner_team_id),
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(homeScore, awayScore, kickoffAt, apiFixtureId, winnerTeamId, match.id).run();

        report.knockout_scores_updated++;
        if (winnerTeamId && match.winner_team_id !== winnerTeamId) report.penalty_winners_set++;
      }
    }
  }

  // ── Phase 4: auto-advance bracket ──
  const bracketMatches = await db.prepare(`
    SELECT id, stage, match_label, home_score, away_score, played,
           home_team_id, away_team_id, winner_team_id, feeder_1_id, feeder_2_id
    FROM matches WHERE stage != 'group' ORDER BY id
  `).all<any>();

  const labelToMatch = new Map<string, any>();
  for (const m of bracketMatches.results) {
    if (m.match_label) labelToMatch.set(m.match_label, m);
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

      if (child.stage === "round_of_16") report.r16_advanced++;
      else if (child.stage === "quarter_final") report.qf_advanced++;
      else if (child.stage === "semi_final") report.sf_advanced++;
      else report.final_advanced++;
    }
  }

  return Response.json({ synced: true, ...report });
}
