import { getDb, isDrawLocked, enableForeignKeys } from "./db";
import { requireAuth } from "./auth";
import { parseJsonBody } from "./shared/validation";

export async function onRequest(context: { request: Request; env: { DB: D1Database; ADMIN_PASSWORD?: string } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "GET") {
    const drawn = await isDrawLocked(db);
    const participants = await db.prepare("SELECT id, name, created_at FROM participants ORDER BY name").all();

    return Response.json({
      drawn,
      participants: participants.results
    });
  }

  if (context.request.method === "POST") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;

    await enableForeignKeys(db);

    const parsed = await parseJsonBody(context.request);
    if (parsed instanceof Response) return parsed;
    const body = parsed.data;
    const name = body.name?.trim();

    if (!name) {
      return Response.json({ error: "Participant name is required." }, { status: 400 });
    }

    if (await isDrawLocked(db)) {
      return Response.json({ error: "Draw is locked. Reset it before adding participants." }, { status: 409 });
    }

    try {
      const result = await db.prepare("INSERT INTO participants (name) VALUES (?)").bind(name).run();
      return Response.json({ id: result.meta.last_row_id, name }, { status: 201 });
    } catch {
      return Response.json({ error: "Participant already exists." }, { status: 409 });
    }
  }

  if (context.request.method === "DELETE") {
    const auth = requireAuth(context.request, context.env);
    if (auth) return auth;

    await enableForeignKeys(db);

    if (await isDrawLocked(db)) {
      return Response.json({ error: "Draw is locked. Reset it before removing participants." }, { status: 409 });
    }

    const parsed = await parseJsonBody(context.request);
    if (parsed instanceof Response) return parsed;
    const body = parsed.data;
    const id = body.id;

    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "Participant ID is required." }, { status: 400 });
    }

    const result = await db.prepare("DELETE FROM participants WHERE id = ?").bind(id).run();
    if (result.meta.changes === 0) {
      return Response.json({ error: "Participant not found." }, { status: 404 });
    }
    return Response.json({ deleted: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
