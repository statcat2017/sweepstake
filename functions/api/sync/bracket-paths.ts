export interface BracketSlot {
  label: string;
  homeTeam: string;
  awayTeam: string;
}

export interface FeederLink {
  childLabel: string;
  parent1Label: string;
  parent2Label: string;
}

const r32: BracketSlot[] = [
  { label: "R32-01", homeTeam: "South Africa", awayTeam: "Canada" },
  { label: "R32-02", homeTeam: "Germany", awayTeam: "Paraguay" },
  { label: "R32-03", homeTeam: "Netherlands", awayTeam: "Morocco" },
  { label: "R32-04", homeTeam: "Brazil", awayTeam: "Japan" },
  { label: "R32-05", homeTeam: "France", awayTeam: "Sweden" },
  { label: "R32-06", homeTeam: "Ivory Coast", awayTeam: "Norway" },
  { label: "R32-07", homeTeam: "Mexico", awayTeam: "Ecuador" },
  { label: "R32-08", homeTeam: "England", awayTeam: "DR Congo" },
  { label: "R32-09", homeTeam: "USA", awayTeam: "Bosnia-Herzegovina" },
  { label: "R32-10", homeTeam: "Belgium", awayTeam: "Senegal" },
  { label: "R32-11", homeTeam: "Portugal", awayTeam: "Croatia" },
  { label: "R32-12", homeTeam: "Spain", awayTeam: "Austria" },
  { label: "R32-13", homeTeam: "Switzerland", awayTeam: "Algeria" },
  { label: "R32-14", homeTeam: "Argentina", awayTeam: "Cape Verde" },
  { label: "R32-15", homeTeam: "Colombia", awayTeam: "Ghana" },
  { label: "R32-16", homeTeam: "Australia", awayTeam: "Egypt" },
];

const dag: FeederLink[] = [
  { childLabel: "R16-01", parent1Label: "R32-01", parent2Label: "R32-05" },
  { childLabel: "R16-02", parent1Label: "R32-03", parent2Label: "R32-04" },
  { childLabel: "R16-03", parent1Label: "R32-02", parent2Label: "R32-06" },
  { childLabel: "R16-04", parent1Label: "R32-07", parent2Label: "R32-08" },
  { childLabel: "R16-05", parent1Label: "R32-11", parent2Label: "R32-12" },
  { childLabel: "R16-06", parent1Label: "R32-09", parent2Label: "R32-10" },
  { childLabel: "R16-07", parent1Label: "R32-14", parent2Label: "R32-16" },
  { childLabel: "R16-08", parent1Label: "R32-13", parent2Label: "R32-15" },
  { childLabel: "QF-1", parent1Label: "R16-01", parent2Label: "R16-02" },
  { childLabel: "QF-2", parent1Label: "R16-03", parent2Label: "R16-04" },
  { childLabel: "QF-3", parent1Label: "R16-05", parent2Label: "R16-06" },
  { childLabel: "QF-4", parent1Label: "R16-07", parent2Label: "R16-08" },
  { childLabel: "SF-1", parent1Label: "QF-1", parent2Label: "QF-2" },
  { childLabel: "SF-2", parent1Label: "QF-3", parent2Label: "QF-4" },
  { childLabel: "Final", parent1Label: "SF-1", parent2Label: "SF-2" },
  { childLabel: "3rd Place", parent1Label: "SF-1", parent2Label: "SF-2" },
];

export function getR32Slots(): BracketSlot[] {
  return r32;
}

export function getBracketDAG(): FeederLink[] {
  return dag;
}

export function getLabelToStage(label: string): string {
  if (label.startsWith("R32-")) return "round_of_32";
  if (label.startsWith("R16-")) return "round_of_16";
  if (label.startsWith("QF-")) return "quarter_final";
  if (label.startsWith("SF-")) return "semi_final";
  if (label === "Final") return "final";
  if (label === "3rd Place") return "third_place";
  return "round_of_32";
}

export function generateBracketSeeds() {
  type Insert = { stage: string; matchLabel: string; feeder1Label?: string; feeder2Label?: string };
  const inserts: Insert[] = [];

  for (let i = 0; i < 16; i++) {
    inserts.push({ stage: "round_of_32", matchLabel: r32[i].label });
  }

  for (const link of dag) {
    inserts.push({
      stage: getLabelToStage(link.childLabel),
      matchLabel: link.childLabel,
      feeder1Label: link.parent1Label,
      feeder2Label: link.parent2Label,
    });
  }

  return inserts;
}

export async function seedBracket(db: D1Database) {
  await db.prepare("DELETE FROM matches WHERE stage != 'group'").run();

  const seeds = generateBracketSeeds();
  const labelToId = new Map<string, number>();

  const insertStage = (start: number, count: number) =>
    db.batch(seeds.slice(start, start + count).map(s =>
      db.prepare("INSERT INTO matches (stage, match_label) VALUES (?, ?)")
        .bind(s.stage, s.matchLabel)
    ));

  const insertWithFeeders = (start: number, count: number) =>
    db.batch(seeds.slice(start, start + count).map(s => {
      const f1Id = labelToId.get(s.feeder1Label!) ?? null;
      const f2Id = labelToId.get(s.feeder2Label!) ?? null;
      return db.prepare(
        "INSERT INTO matches (stage, match_label, feeder_1_id, feeder_2_id) VALUES (?, ?, ?, ?)"
      ).bind(s.stage, s.matchLabel, f1Id, f2Id);
    }));

  const storeIds = (results: any[], start: number, count: number) => {
    const ids = results.map((r: any) => Number(r.meta.last_row_id));
    for (let i = 0; i < count; i++) labelToId.set(seeds[start + i].matchLabel, ids[i]);
    return ids;
  };

  let results = await insertStage(0, 16);
  storeIds(results, 0, 16);

  results = await insertWithFeeders(16, 8);
  storeIds(results, 16, 8);

  results = await insertWithFeeders(24, 4);
  storeIds(results, 24, 4);

  results = await insertWithFeeders(28, 2);
  storeIds(results, 28, 2);

  await insertWithFeeders(30, 2);
}
