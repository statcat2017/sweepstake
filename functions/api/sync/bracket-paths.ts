export interface BracketSlot {
  label: string;
  homeSource: TeamSource;
  awaySource: TeamSource;
}

export type TeamSource =
  | { type: "winner"; group: string }
  | { type: "runner-up"; group: string }
  | { type: "best-third"; groups: string[] };

export interface FeederLink {
  childLabel: string;
  parent1Label: string;
  parent2Label: string;
}

const r32: BracketSlot[] = [
  { label: "R32-01", homeSource: { type: "runner-up", group: "A" }, awaySource: { type: "runner-up", group: "B" } },
  { label: "R32-02", homeSource: { type: "winner", group: "E" }, awaySource: { type: "best-third", groups: ["A", "B", "C", "D", "F"] } },
  { label: "R32-03", homeSource: { type: "winner", group: "F" }, awaySource: { type: "runner-up", group: "C" } },
  { label: "R32-04", homeSource: { type: "winner", group: "C" }, awaySource: { type: "runner-up", group: "F" } },
  { label: "R32-05", homeSource: { type: "winner", group: "I" }, awaySource: { type: "best-third", groups: ["C", "D", "F", "G", "H"] } },
  { label: "R32-06", homeSource: { type: "runner-up", group: "E" }, awaySource: { type: "runner-up", group: "I" } },
  { label: "R32-07", homeSource: { type: "winner", group: "A" }, awaySource: { type: "best-third", groups: ["C", "E", "F", "H", "I"] } },
  { label: "R32-08", homeSource: { type: "winner", group: "L" }, awaySource: { type: "best-third", groups: ["E", "H", "I", "J", "K"] } },
  { label: "R32-09", homeSource: { type: "winner", group: "D" }, awaySource: { type: "best-third", groups: ["B", "E", "F", "I", "J"] } },
  { label: "R32-10", homeSource: { type: "winner", group: "G" }, awaySource: { type: "best-third", groups: ["A", "E", "H", "I", "J"] } },
  { label: "R32-11", homeSource: { type: "runner-up", group: "K" }, awaySource: { type: "runner-up", group: "L" } },
  { label: "R32-12", homeSource: { type: "winner", group: "H" }, awaySource: { type: "runner-up", group: "J" } },
  { label: "R32-13", homeSource: { type: "winner", group: "B" }, awaySource: { type: "best-third", groups: ["E", "F", "G", "I", "J"] } },
  { label: "R32-14", homeSource: { type: "winner", group: "J" }, awaySource: { type: "runner-up", group: "H" } },
  { label: "R32-15", homeSource: { type: "winner", group: "K" }, awaySource: { type: "best-third", groups: ["D", "E", "I", "J", "L"] } },
  { label: "R32-16", homeSource: { type: "runner-up", group: "D" }, awaySource: { type: "runner-up", group: "G" } },
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
