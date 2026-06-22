import { getDb, acquireDrawLock, enableForeignKeys } from "./db";
import { requireAuth } from "./auth";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "POST") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;
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
  await enableForeignKeys(db);

  const participants = await db.prepare("SELECT id FROM participants ORDER BY RANDOM()").all<{ id: number }>();

  if (!participants.results.length) {
    return Response.json({ error: "No participants added yet." }, { status: 400 });
  }

  const missingRanks = await db.prepare("SELECT COUNT(*) AS count FROM teams WHERE fifa_rank IS NULL").first<{ count: number }>();
  if ((missingRanks?.count ?? 0) > 0) {
    return Response.json({ error: "Cannot run ranked draw: some teams are missing fifa_rank." }, { status: 500 });
  }

  const teams = await db.prepare("SELECT id FROM teams ORDER BY fifa_rank ASC").all<{ id: number }>();

  const playerCount = participants.results.length;
  const teamCount = teams.results.length;

  if (playerCount > teamCount) {
    return Response.json({ error: "Not enough teams for all participants." }, { status: 400 });
  }

  if (!(await acquireDrawLock(db))) {
    return Response.json({ error: "Draw has already been locked. Reset it first." }, { status: 409 });
  }

  const potCount = Math.floor(teamCount / playerCount);
  const mainPoolCount = potCount * playerCount;
  const bonusCount = teamCount % playerCount;

  // Split sorted teams into strength pots
  const mainTeams = teams.results.slice(0, mainPoolCount);
  const bonusTeams = teams.results.slice(mainPoolCount);

  const pots: { id: number }[][] = [];
  for (let i = 0; i < potCount; i++) {
    const start = i * playerCount;
    pots.push(mainTeams.slice(start, start + playerCount));
  }

  const assignments: Array<{ participant_id: number; team_id: number; bonus: number; pot: number | null }> = [];

  // Assign one team per pot to each participant
  for (let potIndex = 0; potIndex < pots.length; potIndex++) {
    const shuffledTeams = shuffle(pots[potIndex]);
    const shuffledPlayers = shuffle(participants.results);

    for (let i = 0; i < playerCount; i++) {
      assignments.push({
        participant_id: shuffledPlayers[i].id,
        team_id: shuffledTeams[i].id,
        bonus: 0,
        pot: potIndex + 1
      });
    }
  }

  // Bonus round: lowest-ranked teams to distinct random participants
  if (bonusCount > 0) {
    const bonusRecipients = shuffle(participants.results).slice(0, bonusCount);

    for (let i = 0; i < bonusTeams.length; i++) {
      assignments.push({
        participant_id: bonusRecipients[i].id,
        team_id: bonusTeams[i].id,
        bonus: 1,
        pot: null
      });
    }
  }

  const insertStmt = db.prepare("INSERT OR IGNORE INTO participant_teams (participant_id, team_id, bonus, pot) VALUES (?, ?, ?, ?)");

  try {
    await db.batch(
      assignments.map((a) => insertStmt.bind(a.participant_id, a.team_id, a.bonus, a.pot))
    );
  } catch (err) {
    await db.prepare("UPDATE sweepstake SET drawn = 0, updated_at = datetime('now') WHERE id = 1").run();
    return Response.json({ error: "Draw failed: unable to assign teams." }, { status: 500 });
  }

  const result = await db.prepare(`
    SELECT p.name as participant, t.name as team, t.group_letter, t.flag_emoji, pt.bonus, pt.pot
    FROM participant_teams pt
    JOIN participants p ON p.id = pt.participant_id
    JOIN teams t ON t.id = pt.team_id
    ORDER BY pt.bonus DESC, pt.pot DESC, RANDOM()
  `).all();

  return Response.json({
    drawn: true,
    participantCount: playerCount,
    potCount,
    bonusCount,
    participants: result.results
  });
}

async function handleReset(db: D1Database): Promise<Response> {
  await enableForeignKeys(db);
  await db.batch([
    db.prepare("DELETE FROM participant_teams"),
    db.prepare("DELETE FROM matches WHERE stage = 'group'"),
    db.prepare("DELETE FROM matches WHERE stage != 'group'"),
    db.prepare("UPDATE sweepstake SET drawn = 0, updated_at = datetime('now') WHERE id = 1")
  ]);

  return Response.json({ drawn: false });
}
