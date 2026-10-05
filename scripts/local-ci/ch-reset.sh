#!/bin/bash
# ch-reset.sh: recreate the lane's ClickHouse container empty, then apply the
# migrations, so the ClickHouse step starts on a fresh server as it does in CI.
#
# Why: @kit/clickhouse's verify asserts over the live server ("no watch_time
# rows for a platform the capability matrix says has none", "every live
# platform/content_type pair maps to a format family", ...). On a lane that
# days of Playwright and seed runs wrote into, those fail on leftover rows,
# not on the PR (2026-10-05, #629: 3 failed on 49,704 leftover youtube rows
# and 3,042 test accounts). CI never sees this because its server is new.
#
# Lane A: storybook-clickhouse on 8123 (scripts/local-env.sh's container).
# Lane B: storybook-clickhouse-b on 18123 (scripts/local-ci/lane-b.sh's).
# Runs under the lane's db lock (services.sh holds it); anything else that
# reads the lane's ClickHouse must hold the lock too.
set -eu
CI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAINROOT="$(cd "$CI/../.." && pwd)"
LANE=${LANE:-A}
CH_IMAGE="clickhouse/clickhouse-server:24.8-alpine"
case "$LANE" in
  A) CH_CONTAINER="storybook-clickhouse"; CH_URL="http://localhost:8123"
     EXTRA=(-p 8123:8123) ;;
  B) CH_CONTAINER="storybook-clickhouse-b"; CH_URL="http://localhost:18123"
     EXTRA=(-v "$CI/clickhouse-b.xml:/etc/clickhouse-server/config.d/storybook-logs.xml:ro" --memory 2g -p 18123:8123) ;;
  *) echo "LANE must be A or B, not '$LANE'" >&2; exit 2 ;;
esac

echo "==> ClickHouse $LANE: recreating $CH_CONTAINER ($CH_IMAGE)"
docker rm -f "$CH_CONTAINER" > /dev/null 2>&1 || true
docker run -d --name "$CH_CONTAINER" \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=local \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  "${EXTRA[@]}" "$CH_IMAGE" > /dev/null

for _ in $(seq 1 60); do
  curl -sf "$CH_URL/ping" > /dev/null 2>&1 && break
  sleep 2
done
curl -sf "$CH_URL/ping" > /dev/null || { echo "ClickHouse $LANE did not come up in 120s" >&2; exit 1; }

# @kit/clickhouse reads its target from the environment at import time; run
# standalone (outside services.sh's env) the migrate crashes without these.
export CLICKHOUSE_HOST="$CH_URL" CLICKHOUSE_PASSWORD=local CLICKHOUSE_ENABLED=true
echo "==> ClickHouse $LANE: migrations"
# services.sh runs every step inside the PR's worktree (lib.sh run: cd $WT);
# that checkout's own migrations and node_modules are the ones to use. The
# main checkout is the fallback for a run from elsewhere.
if [ -d "$PWD/packages/clickhouse" ]; then
  pnpm --filter @kit/clickhouse migrate
else
  (cd "$MAINROOT" && pnpm --filter @kit/clickhouse migrate)
fi
tables=$(curl -s "$CH_URL/?user=default&password=local" --data-binary "SELECT count() FROM system.tables WHERE database = 'default' AND name != '_migrations'")
rows=$(curl -s "$CH_URL/?user=default&password=local" --data-binary "SELECT sum(total_rows) FROM system.tables WHERE database = 'default' AND name != '_migrations'")
echo "    fresh: $tables tables, $rows rows"
