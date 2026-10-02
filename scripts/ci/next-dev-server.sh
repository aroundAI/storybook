#!/usr/bin/env bash
#
# The 🧬 E2E guards job's dev server: `next dev --turbo`, restartable between
# guards (KB-165).
#
#   next-dev-server.sh start     start it in its own process group, wait until ready
#   next-dev-server.sh ready     wait for /healthcheck (180s), then warm /auth/sign-in
#   next-dev-server.sh rss       print the server's resident memory in MB
#   next-dev-server.sh restart   stop it and start it again, then wait until ready
#
# Why restart at all: the dev server keeps memory it never gives back. React's
# dev-only async debug tracking (`pendingOperations` in
# react-server-dom-turbopack's server.node.development.js) holds about 32MB
# per run of one spec, reached through old Next request objects, so a shard's
# server grows by gigabytes over its 40 minutes. On a 7GB runner that also
# hosts Supabase, ClickHouse and Chromium, the tail of the shard swaps — a page
# took 104s and PostgREST 3s instead of 30ms (#533's run 36948622003) — or
# Next restarts itself at 80% of its heap in the middle of a guard (run
# 36936270679). run.py reads `rss` before each E2E guard and calls `restart`
# when it is over E2E_DEV_SERVER_MAX_RSS_MB, so a restart never lands inside
# a guard. See KB-165.
#
# NEXT_DEV_PORT (3100), NEXT_DEV_LOG ($RUNNER_TEMP/next-dev.log),
# NEXT_DEV_PIDFILE ($RUNNER_TEMP/next-dev.pid) and NEXT_DEV_NODE_OPTIONS
# (--max-old-space-size=4096) configure it. The log is
# appended to, so one file holds every server the job ran.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
PORT=${NEXT_DEV_PORT:-3100}
LOG=${NEXT_DEV_LOG:-$TMP/next-dev.log}
PIDFILE=${NEXT_DEV_PIDFILE:-$TMP/next-dev.pid}
URL=http://localhost:$PORT

start() {
  # Job control gives the background job a process group of its own, so
  # `stop` takes npx, next's parent process and the server it forks together.
  set -m
  (cd "$ROOT/apps/web" &&
    NODE_OPTIONS=${NEXT_DEV_NODE_OPTIONS:---max-old-space-size=4096} exec npx next dev --turbo -p "$PORT") \
    </dev/null >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  set +m
  ready
}

ready() {
  for attempt in $(seq 1 90); do
    if curl -sf "$URL/healthcheck" >/dev/null; then
      echo "server ready after ${attempt} attempt(s)"
      # Every guard signs in first; compile that page now rather than inside
      # the first guard's attempt budget.
      curl -s -o /dev/null --max-time 120 "$URL/auth/sign-in" || true
      return 0
    fi
    sleep 2
  done
  echo "Next.js did not become ready in 180s"
  tail -50 "$LOG"
  return 1
}

group() {
  ps -o pgid= -p "$(cat "$PIDFILE")" 2>/dev/null | tr -d ' '
}

rss() {
  local pgid
  pgid=$(group)
  if [ -z "$pgid" ]; then
    echo "no dev server running (pid file $PIDFILE)" >&2
    return 1
  fi
  # Every process in the group: the server Next forks holds nearly all of it.
  ps -eo pgid=,rss= | awk -v g="$pgid" '$1 == g { kb += $2 } END { printf "%d\n", kb / 1024 }'
}

stop() {
  local pgid
  pgid=$(group)
  [ -n "$pgid" ] || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 -- "-$pgid" 2>/dev/null || return 0
    sleep 1
  done
  kill -KILL -- "-$pgid" 2>/dev/null || true
}

case "${1:-}" in
  start) start ;;
  ready) ready ;;
  rss) rss ;;
  restart)
    stop
    echo "--- next-dev-server.sh: restarted $(date -u +%FT%TZ) ---" >>"$LOG"
    start
    ;;
  *)
    echo "usage: $0 start|ready|rss|restart" >&2
    exit 2
    ;;
esac
