import { getDb } from "../db";
import { requireAuth } from "../auth";
import { getKickoff } from "./schedule";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = requireAuth(context.request, context.env);
  if (auth) return auth;

  const teams = await db.prepare("SELECT id, group_letter FROM teams ORDER BY group_letter, id").all<{ id: number; group_letter: string }>();
  const groups = new Map<string, number[]>();

  for (const team of teams.results) {
    const group = groups.get(team.group_letter) ?? [];
    group.push(team.id);
    groups.set(team.group_letter, group);
  }

  for (const [group, groupTeams] of groups) {
    if (groupTeams.length !== 4) {
      return Response.json({ error: `Group ${group} has ${groupTeams.length} teams, expected 4.` }, { status: 400 });
    }
  }

  await db.prepare("DELETE FROM matches WHERE stage = 'group'").run();

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
    INSERT INTO matches (stage, group_letter, home_team_id, away_team_id)
    VALUES (?, ?, ?, ?)
  `);

  const results = await db.batch(inserts.map((i) => stmt.bind(i.stage, i.group_letter, i.home_team_id, i.away_team_id)));

  // Set kickoff times from the known schedule
  let matchIdx = 0;
  let currentGroup = '';
  const updateStmt = db.prepare(`
    UPDATE matches SET kickoff_at = ?, updated_at = datetime('now')
    WHERE stage = 'group' AND group_letter = ? AND home_team_id = ? AND away_team_id = ?
  `);
  const kickoffUpdates: D1PreparedStatement[] = [];

  for (const ins of inserts) {
    if (ins.group_letter !== currentGroup) {
      matchIdx = 0;
      currentGroup = ins.group_letter;
    }
    const kickoff = getKickoff(ins.group_letter, matchIdx);
    if (kickoff) {
      kickoffUpdates.push(updateStmt.bind(kickoff, ins.group_letter, ins.home_team_id, ins.away_team_id));
    }
    matchIdx++;
  }

  await db.batch(kickoffUpdates);

  return Response.json({ seeded: results.length });
}
