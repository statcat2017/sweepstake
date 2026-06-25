export interface GroupStandingRow {
  group_letter: string;
  team_id: number;
  team_name: string;
  flag_emoji: string;
  eliminated: number;
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

export function sortByPointsGDGoals(a: { points?: number; goals_for?: number; goals_against?: number; pts?: number; gf?: number; ga?: number }, b: { points?: number; goals_for?: number; goals_against?: number; pts?: number; gf?: number; ga?: number }): number {
  const ptsA = (a.points ?? (a as any).pts ?? 0)
  const ptsB = (b.points ?? (b as any).pts ?? 0)
  if (ptsB !== ptsA) return ptsB - ptsA
  const gdA = (a.goals_for ?? (a as any).gf ?? 0) - (a.goals_against ?? (a as any).ga ?? 0)
  const gdB = (b.goals_for ?? (b as any).gf ?? 0) - (b.goals_against ?? (b as any).ga ?? 0)
  if (gdB !== gdA) return gdB - gdA
  return (b.goals_for ?? (b as any).gf ?? 0) - (a.goals_for ?? (a as any).gf ?? 0)
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

export function rankGroup2026(teams: any[], groupMatches: any[]): any[] {
  const sorted = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return 0;
  });

  const tiers: any[][] = [];
  for (const t of sorted) {
    if (tiers.length === 0 || t.points !== tiers[tiers.length - 1][0].points) {
      tiers.push([t]);
    } else {
      tiers[tiers.length - 1].push(t);
    }
  }

  const result: any[] = [];
  for (const tier of tiers) {
    if (tier.length > 1) {
      result.push(...resolveH2H(tier, groupMatches, 0));
    } else {
      result.push(tier[0]);
    }
  }
  return result;
}

function resolveH2H(teams: any[], groupMatches: any[], depth: number): any[] {
  if (teams.length <= 1) return teams;

  const tids = new Set(teams.map((t: any) => t.team_id));

  let hasH2H = false;
  const h2h: Record<number, { pts: number; gf: number; ga: number }> = {};
  for (const t of teams) h2h[t.team_id] = { pts: 0, gf: 0, ga: 0 };
  for (const m of groupMatches) {
    if (!m.played || !tids.has(m.home_team_id) || !tids.has(m.away_team_id)) continue;
    hasH2H = true;
    const hp = m.home_score > m.away_score ? 3 : m.home_score === m.away_score ? 1 : 0;
    const ap = m.away_score > m.home_score ? 3 : m.home_score === m.away_score ? 1 : 0;
    h2h[m.home_team_id].pts += hp;
    h2h[m.home_team_id].gf += m.home_score;
    h2h[m.home_team_id].ga += m.away_score;
    h2h[m.away_team_id].pts += ap;
    h2h[m.away_team_id].gf += m.away_score;
    h2h[m.away_team_id].ga += m.home_score;
  }

  if (!hasH2H || depth > 5) {
    return [...teams].sort((a: any, b: any) => {
      const aGD = (a.goals_for ?? 0) - (a.goals_against ?? 0);
      const bGD = (b.goals_for ?? 0) - (b.goals_against ?? 0);
      if (bGD !== aGD) return bGD - aGD;
      if ((b.goals_for ?? 0) !== (a.goals_for ?? 0)) return (b.goals_for ?? 0) - (a.goals_for ?? 0);
      return a.team_id - b.team_id;
    });
  }

  const sorted = [...teams].sort((a: any, b: any) => {
    const ha = h2h[a.team_id];
    const hb = h2h[b.team_id];
    if (hb.pts !== ha.pts) return hb.pts - ha.pts;
    const hbGD = hb.gf - hb.ga;
    const haGD = ha.gf - ha.ga;
    if (hbGD !== haGD) return hbGD - haGD;
    if (hb.gf !== ha.gf) return hb.gf - ha.gf;
    const aGD = (a.goals_for ?? 0) - (a.goals_against ?? 0);
    const bGD = (b.goals_for ?? 0) - (b.goals_against ?? 0);
    if (bGD !== aGD) return bGD - aGD;
    if ((b.goals_for ?? 0) !== (a.goals_for ?? 0)) return (b.goals_for ?? 0) - (a.goals_for ?? 0);
    return a.team_id - b.team_id;
  });

  const subTiers: any[][] = [];
  for (const t of sorted) {
    if (subTiers.length === 0) { subTiers.push([t]); continue; }
    const prev = subTiers[subTiers.length - 1][0];
    if (t.team_id === prev.team_id) { subTiers[subTiers.length - 1].push(t); continue; }
    const ha = h2h[t.team_id];
    const hb = h2h[prev.team_id];
    const same = ha.pts === hb.pts &&
      (ha.gf - ha.ga) === (hb.gf - hb.ga) &&
      ha.gf === hb.gf &&
      (t.goals_for ?? 0) - (t.goals_against ?? 0) === (prev.goals_for ?? 0) - (prev.goals_against ?? 0) &&
      (t.goals_for ?? 0) === (prev.goals_for ?? 0);
    if (same) {
      subTiers[subTiers.length - 1].push(t);
    } else {
      subTiers.push([t]);
    }
  }

  const result: any[] = [];
  for (const st of subTiers) {
    if (st.length > 1) {
      result.push(...resolveH2H(st, groupMatches, depth + 1));
    } else {
      result.push(st[0]);
    }
  }
  return result;
}

export function isMathematicallyEliminated(
  team: any,
  allGroupTeams: any[],
  groupMatches: any[]
): boolean {
  const remaining = groupMatches.filter((m: any) => !m.played);
  const teamRemaining = remaining.filter((m: any) =>
    m.home_team_id === team.team_id || m.away_team_id === team.team_id
  );
  const teamMax = (team.points ?? 0) + 3 * teamRemaining.length;

  let definitivelyAhead = 0;

  for (const other of allGroupTeams) {
    if (other.team_id === team.team_id) continue;
    const otherMin = other.points ?? 0;

    if (otherMin > teamMax) {
      definitivelyAhead++;
    } else if (otherMin === teamMax && otherMin > 0) {
      const h2hMatches = groupMatches.filter((m: any) => m.played && (
        (m.home_team_id === team.team_id && m.away_team_id === other.team_id) ||
        (m.home_team_id === other.team_id && m.away_team_id === team.team_id)
      ));
      let teamH = 0, otherH = 0;
      for (const m of h2hMatches) {
        const hp = m.home_score > m.away_score ? 3 : m.home_score === m.away_score ? 1 : 0;
        const ap = m.away_score > m.home_score ? 3 : m.home_score === m.away_score ? 1 : 0;
        if (m.home_team_id === team.team_id) { teamH += hp; otherH += ap; }
        else { teamH += ap; otherH += hp; }
      }
      if (otherH > teamH) definitivelyAhead++;
    }
  }

  return definitivelyAhead > allGroupTeams.length - 3;
}

// Determine definitive third-place qualification status for each group's
// current 3rd-placed team, considering remaining fixtures across ALL groups.
//
// A team is only "qualified" if, no matter how remaining games resolve, it
// cannot fall out of the top 8 third-placed teams. Symmetrically it is only
// "eliminated" if it cannot climb back into the top 8. Otherwise "third"
// (i.e. still to be decided).
//
// The bounds used here are deliberately conservative so the function never
// falsely reports a definitive outcome:
//   * For the "qualified" direction we over-estimate how strong a competitor
//     from an incomplete group could be (any of its 4 teams winning all
//     remaining games), making definitive qualification harder to claim.
//   * For the "eliminated" direction we only count groups that are GUARANTEED
//     to produce a third-placed team ahead of this one (complete groups, or
//     incomplete groups where even the weakest possible 3rd-placed side is
//     already ahead on points).
export function computeThirdPlaceStatus(
  groups: Record<string, any[]>,
  groupMatchesByLetter: Record<string, any[]>
): Record<number, "qualified" | "eliminated" | "third"> {
  const result: Record<number, "qualified" | "eliminated" | "third"> = {};
  const groupLetters = Object.keys(groups);

  interface GroupInfo {
    complete: boolean;
    third: any;
    maxCompetitorPts: number;
    minCurrentPts: number;
  }
  const info: Record<string, GroupInfo> = {};

  for (const letter of groupLetters) {
    const teams = groups[letter];
    const matches = groupMatchesByLetter[letter] || [];
    const complete = teams.every((t: any) => (t.played ?? 0) >= 3);
    const third = teams[2];

    const remaining: Record<number, number> = {};
    for (const t of teams) remaining[t.team_id] = 0;
    for (const m of matches) {
      if (!m.played) {
        if (remaining[m.home_team_id] != null) remaining[m.home_team_id]++;
        if (remaining[m.away_team_id] != null) remaining[m.away_team_id]++;
      }
    }

    let maxCompetitorPts = -Infinity;
    let minCurrentPts = Infinity;
    for (const t of teams) {
      const pts = t.points ?? 0;
      const maxPts = pts + 3 * (remaining[t.team_id] || 0);
      if (maxPts > maxCompetitorPts) maxCompetitorPts = maxPts;
      if (pts < minCurrentPts) minCurrentPts = pts;
    }

    info[letter] = { complete, third, maxCompetitorPts, minCurrentPts };
  }

  // a beats b on the third-place tiebreak (pts, GD, GF).
  // `strict` controls how exact ties on all three criteria are treated:
  //   * strict=false (used for the "qualified" direction) treats ties as a
  //     beat, inflating canBeat so definitive qualification is harder to claim.
  //   * strict=true (used for the "eliminated" direction) treats ties as NOT a
  //     beat, so a competitor that only ties is not counted as guaranteed-ahead
  //     (fair-play/drawing of lots could still favour T).
  const beats = (
    a: { pts: number; gd: number; gf: number },
    b: { pts: number; gd: number; gf: number },
    strict = false,
  ): boolean => {
    if (a.pts !== b.pts) return a.pts > b.pts;
    if (a.gd !== b.gd) return a.gd > b.gd;
    if (a.gf !== b.gf) return a.gf > b.gf;
    return !strict;
  };
  const statOf = (t: any) => ({
    pts: t.points ?? 0,
    gd: (t.goals_for ?? 0) - (t.goals_against ?? 0),
    gf: t.goals_for ?? 0,
  });

  for (const myLetter of groupLetters) {
    const me = info[myLetter];
    const third = me.third;
    if (!third) continue;

    // T must be locked into 3rd in its own group (group complete) before any
    // definitive third-place qualification can be claimed.
    if (!me.complete) {
      result[third.team_id] = "third";
      continue;
    }

    const tStat = statOf(third);

    // ── Qualified? Count groups that could still produce a 3rd ahead of T. ──
    let canBeat = 0;
    for (const otherLetter of groupLetters) {
      if (otherLetter === myLetter) continue;
      const oi = info[otherLetter];
      if (oi.complete) {
        if (beats(statOf(oi.third), tStat)) canBeat++;
      } else if (oi.maxCompetitorPts >= tStat.pts) {
        // An incomplete group could still field a 3rd-placed team that at
        // least ties T on points (and GD is unbounded), so it can overtake.
        canBeat++;
      }
    }
    if (canBeat <= 7) {
      result[third.team_id] = "qualified";
      continue;
    }

    // ── Eliminated? Count groups guaranteed to finish a 3rd ahead of T. ──
    // Use strict tie-break: a competitor that only ties T on pts/GD/GF is NOT
    // counted as guaranteed-ahead (fair-play/drawing of lots may favour T).
    let definiteBeat = 0;
    for (const otherLetter of groupLetters) {
      if (otherLetter === myLetter) continue;
      const oi = info[otherLetter];
      if (oi.complete) {
        if (beats(statOf(oi.third), tStat, true)) definiteBeat++;
      } else if (oi.minCurrentPts > tStat.pts) {
        // Every team in this incomplete group already has more points than T,
        // and points can only grow, so whichever becomes the 3rd-placed side
        // will finish strictly ahead of T on points.
        definiteBeat++;
      }
    }
    result[third.team_id] = definiteBeat >= 8 ? "eliminated" : "third";
  }

  return result;
}

export function resolveTeamSource(
  source: { type: string; group?: string; groups?: string[] },
  qualified: QualifiedTeams,
  usedThirdGroups?: Set<string>
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
      if (source.groups.includes(t.group_letter) && !usedThirdGroups?.has(t.group_letter)) {
        usedThirdGroups?.add(t.group_letter);
        return t.id;
      }
    }
  }
  return null;
}

