import { getDb } from "../db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const teams = await db.prepare("SELECT id, group_letter FROM teams ORDER BY group_letter, id").all<{ id: number; group_letter: string }>();
  const groups = new Map<string, number[]>();

  for (const team of teams.results) {
    const group = groups.get(team.group_letter) ?? [];
    group.push(team.id);
    groups.set(team.group_letter, group);
  }

  const inserts: Array<{ stage: string; group_letter: string; home_team_id: number; away_team_id: number }> = [];

  for (const [group, groupTeams] of groups) {
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[0], away_team_id: groupTeams[1] });
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[2], away_team_id: groupTeams[3] });
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[0], away_team_id: groupTeams[2] });
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[1], away_team_id: groupTeams[3] });
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[0], away_team_id: groupTeams[3] });
    inserts.push({ stage: "group", group_letter: group, home_team_id: groupTeams[1], away_team_id: groupTeams[2] });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO matches (stage, group_letter, home_team_id, away_team_id)
    VALUES (?, ?, ?, ?)
  `);

  const results = await db.batch(inserts.map((i) => stmt.bind(i.stage, i.group_letter, i.home_team_id, i.away_team_id)));

  return Response.json({ seeded: results.length });
}
