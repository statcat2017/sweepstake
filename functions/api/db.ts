interface Env {
  DB: D1Database;
}

export function getDb(env: Env): D1Database {
  return env.DB;
}
