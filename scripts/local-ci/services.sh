#!/bin/bash
# services.sh <pr> <worktree> <outdir>
set -u; PR=$1; WT=$2; OUT=$3; ROWFILE=$OUT/services.rows; : > "$ROWFILE"
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
. $CI/lib.sh
SERVER_PID=""
stop_server() { [ -n "$SERVER_PID" ] && { pkill -P "$SERVER_PID" 2>/dev/null; kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""; }; lsof -ti tcp:$WEB_PORT -sTCP:LISTEN | xargs kill 2>/dev/null; true; }
"$CI/dblock.sh" acquire "localci-$PR" "local CI services for #$PR" >/dev/null
trap 'stop_server; "$CI/dblock.sh" release "localci-$PR" >/dev/null' EXIT
SBENV='eval "$(cd apps/web && supabase status -o env | sed "s/^/export /")"'
run "🐘 Supabase DB" "apply every migration (db reset)" "cd apps/web && bash $CI/db-reset.sh"
run "🐘 Supabase DB" "types are generated" "cd apps/web && pnpm run check:types-current"
run "🐘 Supabase DB" "verify pagination and RLS (PostgREST)" "$SBENV; export NEXT_PUBLIC_SUPABASE_URL=\$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=\$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=\$SERVICE_ROLE_KEY; pnpm --filter @kit/supabase verify"
run "🐘 Supabase DB" "verify canon memory builder" "$SBENV; export NEXT_PUBLIC_SUPABASE_URL=\$API_URL SUPABASE_SERVICE_ROLE_KEY=\$SERVICE_ROLE_KEY E2E_SUPABASE_URL=\$API_URL E2E_SUPABASE_ANON_KEY=\$ANON_KEY E2E_SUPABASE_SERVICE_ROLE_KEY=\$SERVICE_ROLE_KEY; pnpm --filter @kit/episodes verify"
run "🐘 Supabase DB" "pgTAP suite" "pnpm --filter web supabase:test"
run "🐘 Supabase DB" "database mutation guards" "python3 tooling/mutation-guards/run.py --kind pgtap"
# local.env holds lane A's hosts; lane B re-applies its own after it
LANE_REAPPLY=; [ "$LANE" = A ] || LANE_REAPPLY='; . "$CI/lane.sh"'
CH="set -a; . \$MAINROOT/deployment/config/local.env; set +a$LANE_REAPPLY"
# a fresh server per PR, as CI: verify asserts over live rows (ch-reset.sh)
run "🗄️ ClickHouse SQL" "apply migrations" "$CH; LANE=$LANE bash $CI/ch-reset.sh"
run "🗄️ ClickHouse SQL" "execute every query and insert" "$CH; pnpm --filter @kit/clickhouse verify"
# warm Next's compiler cache from the last build on this machine (Next revalidates it)
SEED=$STATE/next-cache-seed
[ -d "$WT/apps/web/.next/cache" ] || { [ -d "$SEED" ] && mkdir -p "$WT/apps/web/.next" && cp -cR "$SEED" "$WT/apps/web/.next/cache"; }
stop_server
run "⚫️ Test" "production build (test env)" "NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter web build:test"
# seed.sql points the invitation and teardown webhooks at :3000. On lane B the
# app is on $WEB_PORT, so without this no invitation email is sent, the
# invitation spec fails, and --max-failures=1 stops Playwright there.
[ "$LANE" = A ] || run "⚫️ Test" "database webhooks point at :$WEB_PORT" "\"$CI/webhooks-to.sh\" $WEB_PORT"
(cd "$WT/apps/web" && NODE_ENV=test next start -p $WEB_PORT > "$OUT/test-server.log" 2>&1) & SERVER_PID=$!
run "⚫️ Test" "server ready" "wait_http http://localhost:$WEB_PORT/healthcheck"
run "⚫️ Test" "Supabase tests" "pnpm --filter web supabase:test"
run "⚫️ Test" "Playwright suite (CI=1: 1 worker, 3 retries, as CI)" "CI=1 ENABLE_BILLING_TESTS=false ENABLE_TEAM_ACCOUNT_TESTS=true pnpm --filter web-e2e test"
stop_server
EV="$CH; export CLICKHOUSE_ENABLED=true CAPTURE_EVIDENCE=1 CLICKHOUSE_EVIDENCE=1 EVIDENCE_DIR=$OUT/evidence ENABLE_BILLING_TESTS=false PLAYWRIGHT_BASE_URL=http://localhost:$WEB_PORT"
run "🧬 E2E evidence" "production build (ClickHouse on)" "$EV; NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter web build:test"
run "🧬 E2E evidence" "server actions all wrapped (KB-58)" "cd packages/next && ACTION_MANIFEST=$WT/apps/web/.next/server/server-reference-manifest.json npx vitest run __tests__/action-manifest.guard.test.ts"
(eval "$EV"; cd "$WT/apps/web" && NODE_ENV=test next start -p $WEB_PORT > "$OUT/evidence-server.log" 2>&1) & SERVER_PID=$!
run "🧬 E2E evidence" "server ready" "wait_http http://localhost:$WEB_PORT/healthcheck"
run "🧬 E2E evidence" "happy-flow evidence specs" "$EV; cd apps/e2e && npx playwright test evidence --project=chromium --workers=1 --retries=2"
stop_server
rm -rf "$SEED.new$LANE_SFX"; cp -cR "$WT/apps/web/.next/cache" "$SEED.new$LANE_SFX" 2>/dev/null && { rm -rf "$SEED"; mv "$SEED.new$LANE_SFX" "$SEED"; }
touch "$OUT/services.done"
