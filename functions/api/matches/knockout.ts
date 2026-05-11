import { getDb } from "../db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const teamsRes = await db.prepare("SELECT id, group_letter FROM teams ORDER BY group_letter, id").all<{ id: number; group_letter: string }>();
  const groups = new Map<string, number[]>();
  for (const t of teamsRes.results) {
    if (!groups.has(t.group_letter)) groups.set(t.group_letter, []);
    groups.get(t.group_letter)!.push(t.id);
  }

  const groupStandings = await db.prepare(`
    SELECT t.id, t.group_letter,
      SUM(CASE WHEN m.home_team_id = t.id THEN CASE WHEN m.home_score > m.away_score THEN 3 WHEN m.home_score = m.away_score THEN 1 ELSE 0 END WHEN m.away_team_id = t.id THEN CASE WHEN m.away_score > m.home_score THEN 3 WHEN m.away_score = m.home_score THEN 1 ELSE 0 ELSE 0 END) as pts,
      SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score WHEN m.away_team_id = t.id THEN m.away_score ELSE 0 END) -
      SUM(CASE WHEN m.home_team_id = t.id THEN m.away_score WHEN m.away_team_id = t.id THEN m.home_score ELSE 0 END) as gd,
      SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score WHEN m.away_team_id = t.id THEN m.away_score ELSE 0 END) as gf
    FROM teams t
    LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id) AND m.stage = 'group'
    GROUP BY t.id
    ORDER BY t.group_letter, pts DESC, gd DESC, gf DESC
  `).all<{ id: number; group_letter: string; pts: number; gd: number; gf: number }>();

  const qualifiers: { [key: string]: { 1: number; 2: number; 3: number } } = {};
  const thirdPlaced: { group: string; pts: number; gd: number; gf: number; team_id: number }[] = [];

  for (const [letter, teamIds] of groups) {
    const groupTeams = groupStandings.results.filter(t => t.group_letter === letter);
    qualifiers[letter] = { 1: groupTeams[0]?.id ?? 0, 2: groupTeams[1]?.id ?? 0, 3: groupTeams[2]?.team_id ?? 0 };
    if (groupTeams[2]) {
      thirdPlaced.push({
        group: letter,
        pts: groupTeams[2].pts,
        gd: groupTeams[2].gd,
        gf: groupTeams[2].gf,
        team_id: groupTeams[2].id
      });
    }
  }

  thirdPlaced.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });

  const q = qualifiers;
  const t = thirdPlaced;

  const knockoutMatches = [
    { stage: "round_of_16", match: "W37", home: q["A"][1], away: q["C"][2], home_label: "1A", away_label: "2C" },
    { stage: "round_of_16", match: "W38", home: q["C"][1], away: q["A"][2], home_label: "1C", away_label: "2A" },
    { stage: "round_of_16", match: "W39", home: q["B"][1], away: q["D"][2], home_label: "1B", away_label: "2D" },
    { stage: "round_of_16", match: "W40", home: q["D"][1], away: q["B"][2], home_label: "1D", away_label: "2B" },
    { stage: "round_of_16", match: "W41", home: q["E"][1], away: t[0]?.team_id ?? 0, home_label: "1E", away_label: "3rd #1" },
    { stage: "round_of_16", match: "W42", home: t[1]?.team_id ?? 0, away: q["F"][1], home_label: "3rd #2", away_label: "1F" },
    { stage: "round_of_16", match: "W43", home: q["F"][2], away: q["E"][2], home_label: "2F", away_label: "2E" },
    { stage: "round_of_16", match: "W44", home: q["H"][1], away: q["G"][2], home_label: "1H", away_label: "2G" },
    { stage: "round_of_16", match: "W45", home: q["G"][1], away: q["H"][2], home_label: "1G", away_label: "2H" },
    { stage: "round_of_16", match: "W46", home: q["J"][1], away: t[2]?.team_id ?? 0, home_label: "1J", away_label: "3rd #3" },
    { stage: "round_of_16", match: "W47", home: t[3]?.team_id ?? 0, away: q["I"][1], home_label: "3rd #4", away_label: "1I" },
    { stage: "round_of_16", match: "W48", home: q["I"][2], away: q["J"][2], home_label: "2I", away_label: "2J" },
    { stage: "quarter_final", match: "W49", home: 0, away: 0, home_label: "W37", away_label: "W38" },
    { stage: "quarter_final", match: "W50", home: 0, away: 0, home_label: "W39", away_label: "W40" },
    { stage: "quarter_final", match: "W51", home: 0, away: 0, home_label: "W41", away_label: "W42" },
    { stage: "quarter_final", match: "W52", home: 0, away: 0, home_label: "W43", away_label: "W44" },
    { stage: "quarter_final", match: "W53", home: 0, away: 0, home_label: "W45", away_label: "W46" },
    { stage: "quarter_final", match: "W54", home: 0, away: 0, home_label: "W47", away_label: "W48" },
    { stage: "semi_final", match: "W55", home: 0, away: 0, home_label: "W49", away_label: "W50" },
    { stage: "semi_final", match: "W56", home: 0, away: 0, home_label: "W51", away_label: "W52" },
    { stage: "semi_final", match: "W57", home: 0, away: 0, home_label: "W53", away_label: "W54" },
    { stage: "semi_final", match: "W58", home: 0, away: 0, home_label: "W55", away_label: "W56" },
    { stage: "third_place", match: "W59", home: 0, away: 0, home_label: "L55", away_label: "L56" },
    { stage: "final", match: "W60", home: 0, away: 0, home_label: "W57", away_label: "W58" },
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO matches (stage, match_label, home_team_id, away_team_id)
    VALUES (?, ?, ?, ?)
  `);

  await db.batch(knockoutMatches.map(m =>
    stmt.bind(m.stage, m.match, m.home, m.away)
  ));

  return Response.json({ seeded: knockoutMatches.length, thirdPlaced: t.map(x => ({ group: x.group, team_id: x.team_id })) });
}