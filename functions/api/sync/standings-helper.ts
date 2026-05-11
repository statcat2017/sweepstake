export interface GroupStandingRow {
  group_letter: string;
  team_id: number;
  team_name: string;
  flag_emoji: string;
  points: number;
  goals_for: number;
  goals_against: number;
  played: number;
}

export interface TeamWithGroup {
  id: number;
  name: string;
  group_letter: string;
  flag_emoji: string;
  pts: number;
  gf: number;
  ga: number;
  gd: number;
  played: number;
}

export interface QualifiedTeams {
  winners: TeamWithGroup[];
  runnersUp: TeamWithGroup[];
  bestThird: TeamWithGroup[];
}

export function sortByPointsGDGoals(a: { points?: number; pts?: number; goals_for?: number; gf?: number; goals_against?: number; ga?: number }, b: { points?: number; pts?: number; goals_for?: number; gf?: number; goals_against?: number; ga?: number }): number {
  const ptsA = (a.points ?? a.pts ?? 0);
  const ptsB = (b.points ?? b.pts ?? 0);
  if (ptsB !== ptsA) return ptsB - ptsA;
  const gdA = (a.goals_for ?? a.gf ?? 0) - (a.goals_against ?? a.ga ?? 0);
  const gdB = (b.goals_for ?? b.gf ?? 0) - (b.goals_against ?? b.ga ?? 0);
  if (gdB !== gdA) return gdB - gdA;
  return (b.goals_for ?? b.gf ?? 0) - (a.goals_for ?? a.gf ?? 0);
}

export function computeGroupStandings(rows: GroupStandingRow[]): Record<string, TeamWithGroup[]> {
  const groups: Record<string, TeamWithGroup[]> = {};
  for (const row of rows) {
    const t: TeamWithGroup = {
      id: row.team_id,
      name: row.team_name,
      group_letter: row.group_letter,
      flag_emoji: row.flag_emoji,
      pts: row.points ?? 0,
      gf: row.goals_for ?? 0,
      ga: row.goals_against ?? 0,
      gd: (row.goals_for ?? 0) - (row.goals_against ?? 0),
      played: row.played ?? 0,
    };
    if (!groups[row.group_letter]) groups[row.group_letter] = [];
    groups[row.group_letter].push(t);
  }
  for (const letter of Object.keys(groups)) {
    groups[letter].sort(sortByPointsGDGoals);
  }
  return groups;
}

export function getQualifiedTeams(groups: Record<string, TeamWithGroup[]>): QualifiedTeams | null {
  const winners: TeamWithGroup[] = [];
  const runnersUp: TeamWithGroup[] = [];
  const thirdPlaced: TeamWithGroup[] = [];

  for (const [letter, teams] of Object.entries(groups)) {
    if (teams.length < 4) return null;
    const allPlayed = teams.every(t => t.played >= 3);
    if (!allPlayed) return null;
    winners.push({ ...teams[0], position: 1 } as any);
    runnersUp.push({ ...teams[1], position: 2 } as any);
    thirdPlaced.push({ ...teams[2], position: 3, gd: teams[2].gd } as any);
  }

  thirdPlaced.sort(sortByPointsGDGoals as any);
  const bestThird = thirdPlaced.slice(0, 8);

  return { winners, runnersUp, bestThird };
}

export function resolveTeamSource(
  source: { type: string; group?: string; groups?: string[] },
  qualified: QualifiedTeams
): number | null {
  if (source.type === "winner") {
    const t = qualified.winners.find(w => w.group_letter === source.group);
    return t?.id ?? null;
  }
  if (source.type === "runner-up") {
    const t = qualified.runnersUp.find(w => w.group_letter === source.group);
    return t?.id ?? null;
  }
  if (source.type === "best-third" && source.groups) {
    for (const t of qualified.bestThird) {
      if (source.groups.includes(t.group_letter)) {
        return t.id;
      }
    }
  }
  return null;
}
