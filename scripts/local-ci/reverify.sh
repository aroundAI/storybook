#!/bin/bash
# reverify.sh <pr>: make a PR that passed local CI merge-ready on the current main.
#  1. rebase onto origin/main (INDEX conflicts via remerge-index.py; a PR still
#     editing the old known-bugs file is ported by split-known-bugs.ts --port)
#  2. if the PR's own code patch is unchanged since its green run (same rule as
#     CI's #353 fast path): light checks; otherwise the full static + services run
#  3. push with lease, post the report as a PR comment (only when all green)
set -u; PR=$1; . "$(dirname "${BASH_SOURCE[0]}")/env.sh"; R=$MAINROOT
OUT=$STATE/runs/$PR; GREEN_SHA=$(grep -o 'Commit tested | `[0-9a-f]*' "$OUT/report.md" | grep -o '[0-9a-f]\{40\}')
grep -q '^## ✅' "$OUT/report.md" || { echo "#$PR has no green report to build on"; exit 1; }
cd $R; git fetch -q origin
MAIN=$(git rev-parse origin/main); WT=$(cat "$OUT/worktree"); REMOTE_HEAD=$(gh pr view $PR --json headRefOid --jq .headRefOid)
if git -C "$WT" merge-base --is-ancestor "$MAIN" "$GREEN_SHA"; then echo "#$PR already on main $MAIN"; exit 0; fi
res=$("$CI/rebase-pr.sh" $PR 2>&1); echo "$res" | grep -E "^#|FAIL"
echo "$res" | grep -q "rebased:" || { echo "#$PR rebase needs a human"; exit 2; }
cd "$WT"; NEW=$(git rev-parse HEAD)
verdict=$(bash scripts/ci/code-patch-unchanged.sh "$GREEN_SHA" "$NEW" "$MAIN" | head -1)
RV=$OUT/reverify; rm -rf "$RV"; mkdir -p "$RV"
if [ "$verdict" = "unchanged=true" ]; then
  MODE="light"; ROWFILE=$RV/static.rows; : > "$ROWFILE"; OUTSAVE=$OUT; OUT=$RV
  . "$CI/lib.sh"
  # Same set as CI's 📚 Docs checks, which is all CI runs for a push that leaves
  # the PR's code patch unchanged (#353). No database, so no lock wait.
  run "setup" "pnpm install" "pnpm install --frozen-lockfile"
  run "📚 Docs checks" "docs-only classifier table test" "bash scripts/ci/docs-only.test.sh"
  run "📚 Docs checks" "unchanged-code classifier table test" "bash scripts/ci/code-patch-unchanged.test.sh"
  run "📚 Docs checks" "spec records guard (KB-80)" "pnpm --filter @kit/shared exec vitest run __tests__/spec-closed-by-drift.test.ts"
  run "📚 Docs checks" "unit tests (scripts/test-units.sh)" "bash scripts/test-units.sh"
  run "📚 Docs checks" "mutation guards self-test" "python3 tooling/mutation-guards/run.py --self-test"
  run "📚 Docs checks" "mutation guards targeting specs/ and docs/" "python3 tooling/mutation-guards/run.py --kind unit --file-prefix specs/ --file-prefix docs/"
  OUT=$OUTSAVE
  NOTE="Re-verified after rebasing onto main: the PR's own code patch is unchanged since its full green run on \`${GREEN_SHA:0:8}\` (same patch-id rule CI uses since #353), so, as CI does since #353, only the 📚 Docs checks set runs below. The PR code on top of the new main is next fully tested by the push-to-main run."
else
  MODE="full"; echo "#$PR code patch changed ($verdict): full run"
  echo "$WT" > "$RV/worktree"
  "$CI/static.sh" $PR "$WT" "$RV"; "$CI/services.sh" $PR "$WT" "$RV"
  NOTE="Re-verified after rebasing onto main with the full suite: the rebase changed the PR's code patch."
fi
"$CI/report.sh" $PR "$WT" "$RV" "$NOTE"
if grep -q '^## ✅' "$RV/report.md"; then
  git -C "$WT" push --force-with-lease="$(git -C "$WT" rev-parse --abbrev-ref HEAD):$REMOTE_HEAD" origin HEAD 2>&1 | tail -1
  for _ in $(seq 1 30); do [ "$(gh pr view $PR --json headRefOid --jq .headRefOid)" = "$NEW" ] && break; sleep 3; done
  [ "$(gh pr view $PR --json headRefOid --jq .headRefOid)" = "$NEW" ] && gh pr comment $PR --body-file "$RV/report.md" && echo "#$PR $MODE re-verify GREEN, pushed and posted"
else
  echo "#$PR $MODE re-verify FAILED; not pushed. See $RV"
fi
