import { apiNameToDbName, dbNameToApiName } from "./team-mapping";
import { getR32Slots } from "./bracket-paths";
import { resolveTeamSource, type QualifiedTeams } from "./standings-helper";

interface ApiFixture {
  league?: { round?: string };
  teams?: {
    home?: { name?: string };
    away?: { name?: string };
  };
}

export async function buildTeamResolver(db: D1Database, errors: string[] = []): Promise<(apiName: string) => number | null> {
  const teams = await db.prepare("SELECT id, name FROM teams").all<any>();
  const nameToDbId = new Map<string, number>();

  for (const team of teams.results) {
    nameToDbId.set(team.name, team.id);
    nameToDbId.set(dbNameToApiName(team.name), team.id);
  }

  return (apiName: string): number | null => {
    const dbName = apiNameToDbName(apiName);
    if (!dbName) return null;

    const id = nameToDbId.get(dbName);
    if (id) return id;

    errors.push(`Team not in DB: '${apiName}'`);
    return null;
  };
}

export async function assignR32TeamsFromFixtures(
  db: D1Database,
  fixtures: ApiFixture[],
  qualified: QualifiedTeams,
  resolveTeam: (apiName: string) => number | null,
): Promise<{ assigned: number; skipped: number; errors: string[] }> {
  const r32Slots = getR32Slots();
  const r32Matches = await db.prepare(`
    SELECT id, home_team_id, away_team_id
    FROM matches
    WHERE stage = 'round_of_32'
    ORDER BY id
  `).all<any>();

  const usedThirdGroups = new Set<string>();
  const errors: string[] = [];
  let assigned = 0;
  let skipped = 0;

  for (let i = 0; i < r32Slots.length && i < r32Matches.results.length; i++) {
    const slot = r32Slots[i];
    const match = r32Matches.results[i];

    if (match.home_team_id && match.away_team_id) continue;

    const provisionalThirdGroups = new Set(usedThirdGroups);
    const expectedHome = resolveTeamSource(slot.homeSource, qualified, provisionalThirdGroups);
    const expectedAway = resolveTeamSource(slot.awaySource, qualified, provisionalThirdGroups);
    if (!expectedHome || !expectedAway) {
      skipped++;
      errors.push(`Could not resolve ${slot.label}`);
      continue;
    }

    let selected: { homeId: number; awayId: number } | null = null;
    for (const fixture of fixtures) {
      const round = (fixture.league?.round || "").toLowerCase();
      if (!round.includes("round of 32")) continue;

      const homeId = fixture.teams?.home?.name ? resolveTeam(fixture.teams.home.name) : null;
      const awayId = fixture.teams?.away?.name ? resolveTeam(fixture.teams.away.name) : null;
      if (!homeId || !awayId) continue;

      const matchesExpected =
        (homeId === expectedHome && awayId === expectedAway) ||
        (homeId === expectedAway && awayId === expectedHome);
      if (matchesExpected) {
        selected = { homeId, awayId };
        break;
      }
    }

    if (!selected) {
      skipped++;
      errors.push(`No API fixture matched ${slot.label}`);
      continue;
    }

    usedThirdGroups.clear();
    for (const group of provisionalThirdGroups) usedThirdGroups.add(group);

    if (match.home_team_id === selected.homeId && match.away_team_id === selected.awayId) continue;

    await db.prepare(`
      UPDATE matches
      SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(selected.homeId, selected.awayId, match.id).run();

    assigned++;
  }

  return { assigned, skipped, errors };
}
