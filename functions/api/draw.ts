import { getDb, isDrawLocked } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "POST") {
    return handleDraw(db);
  }

  if (context.request.method === "DELETE") {
    return handleReset(db);
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleDraw(db: D1Database): Promise<Response> {
  if (await isDrawLocked(db)) {
    return Response.json({ error: "Draw has already been locked. Reset it first." }, { status: 409 });
  }

  const participants = await db.prepare("SELECT id FROM participants ORDER BY RANDOM()").all<{ id: number }>();

  if (!participants.results.length) {
    return Response.json({ error: "No participants added yet." }, { status: 400 });
  }

  const teams = await db.prepare("SELECT id FROM teams ORDER BY RANDOM()").all<{ id: number }>();

  if (teams.results.length < participants.results.length) {
    return Response.json({ error: "Not enough teams for all participants." }, { status: 400 });
  }

  const assignments: Array<{ participant_id: number; team_id: number }> = [];
  const teamsPerParticipant = Math.floor(teams.results.length / participants.results.length);
  let teamIndex = 0;

  for (const participant of participants.results) {
    for (let t = 0; t < teamsPerParticipant; t++) {
      if (teamIndex < teams.results.length) {
        assignments.push({ participant_id: participant.id, team_id: teams.results[teamIndex].id });
        teamIndex++;
      }
    }
  }

  const insertStmt = db.prepare("INSERT OR IGNORE INTO participant_teams (participant_id, team_id) VALUES (?, ?)");
  const updateStmt = db.prepare("UPDATE sweepstake SET drawn = 1, updated_at = datetime('now') WHERE id = 1");

  await db.batch([
    ...assignments.map((a) => insertStmt.bind(a.participant_id, a.team_id)),
    updateStmt
  ]);

  const result = await db.prepare(`
    SELECT p.name as participant, t.name as team, t.group_letter, t.flag_emoji
    FROM participant_teams pt
    JOIN participants p ON p.id = pt.participant_id
    JOIN teams t ON t.id = pt.team_id
    ORDER BY p.name, t.name
  `).all();

  return Response.json({ drawn: true, participants: result.results });
}

async function handleReset(db: D1Database): Promise<Response> {
  await db.batch([
    db.prepare("DELETE FROM participant_teams"),
    db.prepare("DELETE FROM matches"),
    db.prepare("UPDATE sweepstake SET drawn = 0, updated_at = datetime('now') WHERE id = 1")
  ]);

  return Response.json({ drawn: false });
}
