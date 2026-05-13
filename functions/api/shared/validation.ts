export async function parseJsonBody(request: Request): Promise<{ data: any } | Response> {
  try {
    return { data: await request.json() }
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }
}

export function validateScores(home_score: unknown, away_score: unknown): Response | { home: number; away: number } {
  const hasHome = home_score !== undefined && home_score !== null
  const hasAway = away_score !== undefined && away_score !== null

  if (hasHome !== hasAway) {
    return Response.json({ error: "Both scores must be supplied together." }, { status: 400 })
  }

  if (!hasHome && !hasAway) {
    return Response.json({ error: "Scores are required." }, { status: 400 })
  }

  if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
    return Response.json({ error: "Scores must be integers." }, { status: 400 })
  }

  const h = home_score as number
  const a = away_score as number
  if (h < 0 || a < 0) {
    return Response.json({ error: "Scores must be non-negative." }, { status: 400 })
  }

  return { home: h, away: a }
}

export function validateId(body: any): Response | number {
  if (!body.id || !Number.isInteger(body.id) || body.id < 1) {
    return Response.json({ error: "Valid match ID is required." }, { status: 400 })
  }
  return body.id
}
