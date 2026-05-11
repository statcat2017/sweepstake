export function requireAuth(request: Request, env: { ADMIN_PASSWORD?: string }): Response | null {
  const password = env.ADMIN_PASSWORD;
  if (!password) {
    return Response.json(
      { error: "Server not configured with a password." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${password}`) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}
