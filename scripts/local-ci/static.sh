#!/bin/bash
# static.sh <pr> <worktree> <outdir>: the jobs that need no shared service.
# The unit-guard shards run on copy-on-write clones, 2 at a time: the runner
# rewrites source files in place, so shards must not share a tree, and 4 at once
# next to Docker exhausted this Mac's memory.
set -u; PR=$1; WT=$2; OUT=$3; ROWFILE=$OUT/static.rows; : > "$ROWFILE"
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
. $CI/lib.sh
run "setup" "pnpm install" "pnpm install --frozen-lockfile"
CL=$OUT/clones; rm -rf "$CL"; mkdir -p "$CL"
for i in 1 2 3 4; do (cp -cR "$WT" "$CL/s$i" 2>/dev/null; rm -rf "$CL/s$i/apps/web/.next") & done
run "ʦ TypeScript" "typecheck" "pnpm run typecheck"
run "ʦ TypeScript" "lint" "pnpm run lint"
run "💅 Format" "format (check)" "pnpm turbo format --force --continue -- --ignore-path=../../.gitignore --ignore-path=../../.prettierignore"
run "🧪 Unit Tests" "docs-only classifier table test" "bash scripts/ci/docs-only.test.sh"
run "🧪 Unit Tests" "unchanged-code classifier table test" "[ ! -f scripts/ci/code-patch-unchanged.test.sh ] || bash scripts/ci/code-patch-unchanged.test.sh"
run "🧪 Unit Tests" "unit tests (scripts/test-units.sh)" "bash scripts/test-units.sh"
run "🧪 Unit Tests" "mutation guards self-test" "python3 tooling/mutation-guards/run.py --self-test"
run "🧪 Unit Tests" "coverage report" "pnpm --filter web test:coverage"
run "🐘 Supabase DB" "schema drift" "cd apps/web && pnpm run check:schema-drift"
run "🐘 Supabase DB" "supabase-start script test" "bash scripts/ci/supabase-start.test.sh"
wait  # clones ready
t0=$(date +%s)
for pair in "1 2" "3 4"; do
  pids=""
  for i in $pair; do
    (cd "$CL/s$i" && python3 tooling/mutation-guards/run.py --kind unit --shard $i/4 > "$OUT/Unit-guards-shard-$i.log" 2>&1) &
    pids="$pids $!:$i"
  done
  for pi in $pids; do
    wait "${pi%%:*}"; rc=$?; i=${pi##*:}; mark="✅"; [ $rc -ne 0 ] && mark="❌"
    echo "$mark|🧪 Unit guards|shard $i/4|$(( $(date +%s) - t0 ))s|Unit-guards-shard-$i.log" >> "$ROWFILE"
    echo "#$PR $mark 🧪 Unit guards / shard $i/4"
  done
done
rm -rf "$CL"
touch "$OUT/static.done"
