#!/bin/bash
# stop.sh <pr> [--keep-run]
#
# Stops a local-CI pipeline and everything it started, then clears its run
# directory, so the next run starts from nothing.
#
# `pkill -f "pipeline.sh <pr>"` is not enough: it ends the parent and leaves
# its children running, and they go on writing. On 2026-09-30 the orphans were
# the mutation-guard runners and a pgTAP guard, which kept mutating the shared
# database and creating and deleting `zz-mutation-guard.test.sql` in the PR's
# worktree; the restarted run then failed on that file, and again when its
# clone directory could not be emptied. Children are stopped first and the
# parent last, while the tree can still be walked.
set -u
PR=${1:?usage: stop.sh <pr> [--keep-run]}
KEEP_RUN=${2:-}
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

# `LOCAL_CI_STOP_MATCH` narrows what counts as "the pipeline", for the test.
MATCH=${LOCAL_CI_STOP_MATCH:-scripts/local-ci/pipeline.sh $PR}

descendants() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    descendants "$child"
    echo "$child"
  done
}

stopped=0
roots=$(pgrep -f "$MATCH" 2>/dev/null | grep -vx "$$" || true)

for root in $roots; do
  for pid in $(descendants "$root") "$root"; do
    kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
  done
done

# Anything a guard or a test run started that is no longer in the tree.
if [ -z "${LOCAL_CI_STOP_MATCH:-}" ]; then
  pkill -f "$MAINROOT/.local-ci/.*mutation-guards/run.py" 2>/dev/null || true
  pkill -f "tooling/mutation-guards/run.py" 2>/dev/null || true
  lsof -ti "tcp:$WEB_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
fi

sleep 2

# What ignored the first signal.
for pid in $(for root in $roots; do descendants "$root"; echo "$root"; done); do
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
done

left=$(pgrep -f "$MATCH" 2>/dev/null | grep -vx "$$" || true)

if [ -n "$left" ]; then
  echo "still running after the stop: $left" >&2
  exit 1
fi

if [ "$KEEP_RUN" != "--keep-run" ] && [ -d "$STATE/runs/$PR" ]; then
  rm -rf "$STATE/runs/$PR"
fi

echo "stopped $stopped process(es) for #$PR; nothing left"
