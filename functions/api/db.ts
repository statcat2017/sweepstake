interface Env {
  DB: D1Database;
}

export function getDb(env: Env): D1Database {
  return env.DB;
}

export async function isDrawLocked(db: D1Database): Promise<boolean> {
  const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();
  return !!(state?.drawn);
}
