#!/bin/bash
# lane-b.sh up|down|status: the second local-CI stack (see lane.sh).
#   up      start Supabase project storybook-b (5542x) and ClickHouse
#           storybook-clickhouse-b (18123), apply ClickHouse migrations
#   down    stop both (the database volume is kept, as `supabase stop` does)
#   status  what's running and how much memory it takes
# Lane A is never touched: every command here runs with LANE=B.
set -u
export LANE=B
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
SB="$MAINROOT/apps/web/node_modules/.bin/supabase"   # the pinned CLI, as lib.sh uses
CH_CONTAINER=storybook-clickhouse-b
CH_IMAGE=clickhouse/clickhouse-server:24.8-alpine

case "${1:-}" in
  up)
    echo "==> Supabase (project storybook-b)"
    # Excluded: studio, the edge runtime and the log pipeline. No CI step
    # uses them, and they are a third of the stack's memory.
    (cd "$MAINROOT/apps/web" && "$SB" status >/dev/null 2>&1 || "$SB" start -x studio,edge-runtime,vector,logflare,imgproxy,supavisor)
    echo "==> ClickHouse ($CH_CONTAINER on 18123)"
    if docker ps -a --format '{{.Names}}' | grep -qx "$CH_CONTAINER"; then
      docker start "$CH_CONTAINER" > /dev/null
    else
      docker run -d --name "$CH_CONTAINER" \
        -e CLICKHOUSE_USER=default -e CLICKHOUSE_PASSWORD=local \
        -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
        --memory 2g -p 18123:8123 "$CH_IMAGE" > /dev/null
    fi
    for _ in $(seq 1 60); do curl -sf "$CH_URL/ping" >/dev/null && break; sleep 2; done
    curl -sf "$CH_URL/ping" >/dev/null || { echo "ClickHouse B did not come up"; exit 1; }
    echo "==> ClickHouse migrations"
    (cd "$MAINROOT" && set -a && . deployment/config/local.env && set +a && . "$CI/lane.sh" && pnpm --filter @kit/clickhouse migrate)
    "$0" status ;;
  down)
    (cd "$MAINROOT/apps/web" && "$SB" stop)
    docker stop "$CH_CONTAINER" >/dev/null 2>&1; true ;;
  status)
    (cd "$MAINROOT/apps/web" && "$SB" status -o env 2>/dev/null | grep -E '^(API_URL|DB_URL|MAILPIT_URL)=') || echo "Supabase B: not running"
    echo "ClickHouse B: $(curl -sf "$CH_URL/ping" 2>/dev/null || echo down)"
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep -E '_storybook-b$|clickhouse-b' ;;
  *) echo "usage: $0 up|down|status"; exit 2 ;;
esac
