import { getDb, isDrawLocked } from "./db";
import { requireAuth } from "./auth";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "POST") {
    return handleDraw(db);
  }

  if (context.request.method === "DELETE") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;
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

  const missingRanks = await db.prepare("SELECT COUNT(*) AS count FROM teams WHERE fifa_rank IS NULL").first<{ count: number }>();
  if ((missingRanks?.count ?? 0) > 0) {
    return Response.json({ error: "Cannot run ranked draw: some teams are missing fifa_rank." }, { status: 500 });
  }

  const teams = await db.prepare("SELECT id FROM teams ORDER BY fifa_rank ASC").all<{ id: number }>();

  if (teams.results.length < participants.results.length) {
    return Response.json({ error: "Not enough teams for all participants." }, { status: 400 });
  }

  const teamsPerParticipant = Math.floor(teams.results.length / participants.results.length);
  const mainPoolCount = participants.results.length * teamsPerParticipant;

  // Main pool: best teams split evenly
  const mainPool = [...teams.results.slice(0, mainPoolCount)].sort(() => Math.random() - 0.5);
  // Bonus pool: lowest-ranked teams
  const bonusPool = teams.results.slice(mainPoolCount);

  const assignments: Array<{ participant_id: number; team_id: number; bonus: number }> = [];
  let teamIndex = 0;

  for (const participant of participants.results) {
    for (let t = 0; t < teamsPerParticipant; t++) {
      if (teamIndex < mainPool.length) {
        assignments.push({ participant_id: participant.id, team_id: mainPool[teamIndex].id, bonus: 0 });
        teamIndex++;
      }
    }
  }

  // Bonus round: each bonus team goes to a random participant
  for (const bonusTeam of bonusPool) {
    const lucky = participants.results[Math.floor(Math.random() * participants.results.length)];
    assignments.push({ participant_id: lucky.id, team_id: bonusTeam.id, bonus: 1 });
  }

  const insertStmt = db.prepare("INSERT OR IGNORE INTO participant_teams (participant_id, team_id, bonus) VALUES (?, ?, ?)");
  const updateStmt = db.prepare("UPDATE sweepstake SET drawn = 1, updated_at = datetime('now') WHERE id = 1");

  await db.batch([
    ...assignments.map((a) => insertStmt.bind(a.participant_id, a.team_id, a.bonus)),
    updateStmt
  ]);

  const result = await db.prepare(`
    SELECT p.name as participant, t.name as team, t.group_letter, t.flag_emoji, pt.bonus
    FROM participant_teams pt
    JOIN participants p ON p.id = pt.participant_id
    JOIN teams t ON t.id = pt.team_id
    ORDER BY RANDOM()
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
