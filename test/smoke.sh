#!/bin/bash
set -euo pipefail

# Sweepstake API smoke test
# Usage: ./test/smoke.sh [base_url] [password]
# Requires the wrangler dev server to be running.

BASE="${1:-http://localhost:8787}"
PASSWORD="${2:-sweepstake2026}"
AUTH="Authorization: Bearer $PASSWORD"
JSON="Content-Type: application/json"

PASS=0
FAIL=0
CREATED_PARTICIPANTS=""

cleanup() {
  for id in $CREATED_PARTICIPANTS; do
    curl -sf -X DELETE "$BASE/api/participants" \
      -H "$AUTH" -H "$JSON" -d "{\"id\":$id}" > /dev/null 2>&1 || true
  done
  curl -sf -X DELETE "$BASE/api/draw" -H "$AUTH" > /dev/null 2>&1 || true
}
trap cleanup EXIT

check() {
  local desc="$1" expected="$2"
  shift 2
  local code
  code=$(curl -s -o /tmp/smoke_resp -w '%{http_code}' "$@")
  if [ "$code" = "$expected" ]; then
    echo "  PASS [$code] $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL [$code] $desc (expected $expected)"
    echo "       $(cat /tmp/smoke_resp)"
    FAIL=$((FAIL + 1))
  fi
}

check200() { check "$1" 200 "${@:2}"; }
check201() { check "$1" 201 "${@:2}"; }
check401() { check "$1" 401 "${@:2}"; }

echo ""
echo "============================================================"
echo "  Sweepstake Smoke Test"
echo "  Server: $BASE"
echo "============================================================"

# --- ensure server is reachable ---
if ! curl -sf "$BASE/api/teams" > /dev/null 2>&1; then
  echo "FAIL: Cannot reach $BASE — is the dev server running?"
  exit 1
fi

echo ""
echo "--- 1. Public GET endpoints ---"
check200 "GET /api/teams"           "$BASE/api/teams"
check200 "GET /api/participants"    "$BASE/api/participants"
check200 "GET /api/matches"         "$BASE/api/matches"
check200 "GET /api/standings"       "$BASE/api/standings"
check200 "GET /api/matches/knockout" "$BASE/api/matches/knockout"

echo ""
echo "--- 2. Auth: mutating endpoints reject without password ---"
check401 "POST /api/participants"   -X POST "$BASE/api/participants"   -H "$JSON" -d '{"name":"noauth"}'
check401 "DELETE /api/draw"         -X DELETE "$BASE/api/draw"
check401 "PUT /api/matches"         -X PUT "$BASE/api/matches"         -H "$JSON" -d '{"id":1,"home_score":9}'
check401 "POST /api/matches/seed"   -X POST "$BASE/api/matches/seed"
check401 "POST /api/matches/knockout" -X POST "$BASE/api/matches/knockout"
check401 "POST /api/matches/advance"  -X POST "$BASE/api/matches/advance"

echo ""
echo "--- 3. Participant CRUD (authenticated) ---"

# Clean up any leftover smoke-test participants from previous runs
EXISTING_IDS=$(curl -sf "$BASE/api/participants" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ids = [str(p['id']) for p in d['participants'] if p['name'].startswith('Smoke')]
print(' '.join(ids))
" 2>/dev/null)
for eid in $EXISTING_IDS; do
  curl -sf -X DELETE "$BASE/api/participants" -H "$AUTH" -H "$JSON" -d "{\"id\":$eid}" > /dev/null 2>&1 || true
done

add_participant() {
  local name="$1"
  local resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/participants" -H "$AUTH" -H "$JSON" -d "{\"name\":\"$name\"}")
  local code=$(echo "$resp" | tail -1)
  local body=$(echo "$resp" | sed '$d')
  local id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
  if [ "$code" = "201" ]; then
    echo "  PASS [$code] Add $name" >&2
    PASS=$((PASS + 1))
  else
    echo "  FAIL [$code] Add $name — $body" >&2
    FAIL=$((FAIL + 1))
  fi
  echo "$id"
}

ALICE_ID=$(add_participant "SmokeAlice")
BOB_ID=$(add_participant "SmokeBob")
CAROL_ID=$(add_participant "SmokeCarol")
CREATED_PARTICIPANTS="$ALICE_ID $BOB_ID $CAROL_ID"
echo "  Created participants: $CREATED_PARTICIPANTS"

# Duplicate name should fail
check "Add duplicate" 409 -X POST "$BASE/api/participants" -H "$AUTH" -H "$JSON" -d '{"name":"SmokeAlice"}'

# Delete one
check200 "Delete Bob"  -X DELETE "$BASE/api/participants" -H "$AUTH" -H "$JSON" -d "{\"id\":$BOB_ID}"
CREATED_PARTICIPANTS="$ALICE_ID $CAROL_ID"

echo ""
echo "--- 4. Draw flow ---"
check200 "Run draw" -X POST "$BASE/api/draw"
DRAW_INFO=$(curl -sf "$BASE/api/standings" | python3 -c "
import sys, json
d = json.load(sys.stdin)
teams = sum(p['team_count'] for p in d['participants'])
parts = len(d['participants'])
print(f'drawn={d[\"drawn\"]}, participants={parts}, teams_assigned={teams}')
" 2>/dev/null)
echo "  $DRAW_INFO"

# Second draw should be rejected
check "Draw locked" 409 -X POST "$BASE/api/draw"

echo ""
echo "--- 5. Match seeding & scores ---"
check200 "Seed group matches" -X POST "$BASE/api/matches/seed" -H "$AUTH"
M_COUNT=$(curl -sf "$BASE/api/matches" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['matches']))" 2>/dev/null)
echo "  Group matches: $M_COUNT"
if [ "$M_COUNT" != "72" ]; then
  echo "  FAIL: expected 72 group matches, got $M_COUNT"
  FAIL=$((FAIL + 1))
fi

MID=$(curl -sf "$BASE/api/matches" | python3 -c "import sys,json; print(json.load(sys.stdin)['matches'][0]['id'])" 2>/dev/null)
check200 "Set score 2-1" -X PUT "$BASE/api/matches" -H "$AUTH" -H "$JSON" \
  -d "{\"id\":$MID,\"home_score\":2,\"away_score\":1}"
check200 "Standings reflect score" "$BASE/api/standings"

echo ""
echo "--- 6. Knockout bracket ---"
check200 "Seed knockout" -X POST "$BASE/api/matches/knockout" -H "$AUTH"
KO_INFO=$(curl -sf "$BASE/api/matches/knockout" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'matches={len(d[\"matches\"])}, eligible_teams={len(d[\"eligibleTeams\"])}')
" 2>/dev/null)
echo "  $KO_INFO"
KO_MATCHES=$(echo "$KO_INFO" | grep -o 'matches=[0-9]*' | cut -d= -f2)
if [ "$KO_MATCHES" != "32" ]; then
  echo "  FAIL: expected 32 knockout matches, got $KO_MATCHES"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "--- 7. Reset ---"
check200 "Reset draw" -X DELETE "$BASE/api/draw" -H "$AUTH"
RESET_DRAWN=$(curl -sf "$BASE/api/standings" | python3 -c "import sys,json; print(json.load(sys.stdin)['drawn'])" 2>/dev/null)
if [ "$RESET_DRAWN" != "False" ]; then
  echo "  FAIL: expected drawn=False after reset, got $RESET_DRAWN"
  FAIL=$((FAIL + 1))
else
  echo "  PASS drawn reset to False"
  PASS=$((PASS + 1))
fi

echo ""
echo "============================================================"
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: $PASS/$((PASS + FAIL)) PASS"
  echo "============================================================"
  exit 0
else
  echo "  RESULT: $FAIL FAILURE(S) out of $((PASS + FAIL)) tests"
  echo "============================================================"
  exit 1
fi
