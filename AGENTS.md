# Sweepstake (WC2026)

Cloudflare Pages site + Pages Functions (TypeScript) + D1 database.

## Workflow

- Always create a feature branch (`feature/description`) for changes — never work on `main` directly.
- All changes go through PRs. Create a PR after implementing and testing.

## Commands

```bash
npm run dev          # start dev server (with D1 bindings)
npm run deploy       # deploy to production (--branch main)
npm run db:init      # create tables from schema.sql
npm run db:seed      # load 48 WC2026 teams
npm run db:migrate   # run schema-migration.sql
npm run db:migrate-fifa-rank  # apply fifa_rank column + data
npm run db:migrate-draw-fix   # catch-up for partial migration (winner_team_id + fifa_rank + ranks)
npm run db:reset     # DROP ALL tables (incl. knockout_picks)
npm run smoke        # run test/smoke.sh against http://localhost:8787
```

Smoke test expects dev server running at `http://localhost:8787`. Default password is `sweepstake2026` (override as arg 2).

**Order of operations:** `db:init` → `db:seed` → (optional `db:migrate`) → then use /api endpoints.

## Env

`.dev.vars` must exist locally and contain:
- `ADMIN_PASSWORD` — Bearer token for mutating endpoints
- `FOOTBALL_API_KEY` — key for api-sports.io (sync endpoint)

## Architecture

- **Frontend:** Vanilla HTML/CSS/JS in `public/` — no build step. SPA loads `GET /api/participants` and `GET /api/standings`.
- **Backend:** `functions/api/*.ts` — each file is a Cloudflare Pages Function. TypeScript runs natively (no compilation).
- **Database:** Cloudflare D1 (`sweepstake-db`), bound as `DB`. Schema: `schema.sql`. Teams match the 48-team, 12-group 2026 format.
- **Auth:** `requireAuth()` checks `Authorization: Bearer <ADMIN_PASSWORD>`. GET endpoints are public; POST/PUT/DELETE require auth.

## Key Endpoints (all under `/api/`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/teams` | No | List all 48 teams |
| GET | `/participants` | No | List participants + draw status |
| POST | `/participants` | Yes | Add participant |
| DELETE | `/participants` | Yes | Remove participant |
| POST | `/draw` | No | Randomly assign teams to participants |
| DELETE | `/draw` | Yes | Reset draw, clear matches |
| GET | `/matches` | No | All matches |
| PUT | `/matches` | Yes | Set group match score |
| POST | `/matches/seed` | Yes | Generate 72 group match fixtures |
| GET | `/matches/knockout` | No | Bracket + eligible teams |
| POST | `/matches/knockout` | Yes | Seed 32-match knockout bracket |
| PUT | `/matches/knockout` | Yes | Update knockout match (teams/scores) |
| POST | `/matches/advance` | Yes | Auto-advance winners in bracket |
| GET | `/standings` | No | Full standings (groups, participants, knockout) |
| POST | `/sync` | Yes | Fetch live scores from API-Football |

## Draw algorithm

The draw uses FIFA rankings (April 2026). Teams are sorted by rank ascending. The top `participants * floor(48 / participants)` teams form the main pool (shuffled, distributed round-robin). The remaining `48 % participants` teams (lowest-ranked) form the bonus pool, each randomly assigned to a participant with independent draws.

## Bracket (2026 48-team format)

12 groups of 4 → top 2 per group + 8 best 3rd-place teams → 32 R32 → 16 R16 → 8 QF → 4 SF → Final + 3rd Place. The DAG is defined in `functions/api/sync/bracket-paths.ts`.

## Sync (live scores)

`POST /api/sync` fetches fixtures from `api-sports.io`, matches by team pair, updates scores, and auto-advances the bracket when parent matches resolve. Team name mapping (e.g. `Czechia` ↔ `Czech Republic`) is in `functions/api/sync/team-mapping.ts`. Requires `FOOTBALL_API_KEY` env var.

## Testing

Only test is `test/smoke.sh` — a bash script that exercises the full lifecycle via curl against a running dev server. No unit/integration test framework. Run with `npm run smoke`.

## Gotchas

- No `tsconfig.json`, no ESLint, no Prettier, no CI. TypeScript is validated only at wrangler runtime.
- `data/` and `test-results/` are gitignored.
- Schema migrations go in `schema-migration.sql` and are applied via `npm run db:migrate`.
- The frontend SPA polls `GET /api/participants` and `GET /api/standings` — no client-side routing.
