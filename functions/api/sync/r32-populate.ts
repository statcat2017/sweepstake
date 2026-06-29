import { apiNameToDbName, dbNameToApiName } from "./team-mapping";
import { getR32Slots } from "./bracket-paths";
import type { QualifiedTeams } from "./standings-helper";

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

export async function assignR32TeamsFromQualified(
  db: D1Database,
  _qualified: QualifiedTeams,
): Promise<{ assigned: number; skipped: number; errors: string[] }> {
  const r32Slots = getR32Slots();
  const r32Matches = await db.prepare(`
    SELECT id, home_team_id, away_team_id
    FROM matches
    WHERE stage = 'round_of_32'
    ORDER BY id
  `).all<any>();

  const errors: string[] = [];
  const resolveTeam = await buildTeamResolver(db, errors);
  let assigned = 0;
  let skipped = 0;

  for (let i = 0; i < r32Slots.length && i < r32Matches.results.length; i++) {
    const slot = r32Slots[i];
    const match = r32Matches.results[i];

    const homeId = resolveTeam(slot.homeTeam);
    const awayId = resolveTeam(slot.awayTeam);
    if (!homeId || !awayId) {
      skipped++;
      errors.push(`Could not resolve ${slot.label}: ${slot.homeTeam} vs ${slot.awayTeam}`);
      continue;
    }

    if (match.home_team_id === homeId && match.away_team_id === awayId) continue;

    await db.prepare(`
      UPDATE matches
      SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(homeId, awayId, match.id).run();

    assigned++;
  }

  return { assigned, skipped, errors };
}
