import { getDb } from "./db";

export async function onRequest(context: { request: Request; env: { DB: D1Database } }): Promise<Response> {
  const db = getDb(context.env);

  if (context.request.method === "GET") {
    const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();
    const participants = await db.prepare("SELECT id, name, created_at FROM participants ORDER BY name").all();

    return Response.json({
      drawn: state?.drawn ?? false,
      participants: participants.results
    });
  }

  if (context.request.method === "POST") {
    const body = await context.request.json() as { name: string };
    const name = body.name?.trim();

    if (!name) {
      return Response.json({ error: "Participant name is required." }, { status: 400 });
    }

    const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();

    if (state?.drawn) {
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
    const state = await db.prepare("SELECT drawn FROM sweepstake WHERE id = 1").first<{ drawn: number }>();

    if (state?.drawn) {
      return Response.json({ error: "Draw is locked. Reset it before removing participants." }, { status: 409 });
    }

    const body = await context.request.json() as { id?: number };
    const id = body.id;

    if (!id) {
      return Response.json({ error: "Participant ID is required." }, { status: 400 });
    }

    await db.prepare("DELETE FROM participants WHERE id = ?").bind(id).run();
    return Response.json({ deleted: true });
  }

  return new Response("Method not allowed", { status: 405 });
}
