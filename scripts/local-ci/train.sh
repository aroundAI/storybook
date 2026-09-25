#!/bin/bash
# train.sh <pr> [<pr>...]: merge train, one PR at a time, in the order given.
# For each PR: wait for its full local CI report; stop if it is not all green;
# rebase onto current main and re-verify (reverify.sh: light if the PR's own
# code patch is unchanged, full otherwise); if green, merge exactly that commit
# (squash, --match-head-commit). Stops, and asks a human, on any failure.
set -u; . "$(dirname "${BASH_SOURCE[0]}")/env.sh"; R=$MAINROOT
say() { echo "[$(date '+%H:%M')] $*" | tee -a "$STATE/train.log"; }
for PR in "$@"; do
  OUT=$STATE/runs/$PR
  say "#$PR: waiting for its full local CI report"
  until [ -f "$OUT/report.md" ]; do sleep 20; done
  grep -q '^## ✅' "$OUT/report.md" || { say "#$PR: full local CI is NOT green; stopping the train"; exit 1; }
  while pgrep -f "reverify.sh $PR\b" >/dev/null; do sleep 20; done  # a re-verify already in flight
  [ "$(gh pr view $PR --json state --jq .state)" = OPEN ] || { say "#$PR is not open; skipping"; continue; }
  cd $R; git fetch -q origin; MAIN=$(git rev-parse origin/main)
  HEAD_SHA=$(gh pr view $PR --json headRefOid --jq .headRefOid)
  RV=$OUT/reverify/report.md
  # the full run itself was on this exact commit over this exact main: post it and merge
  if grep -q "Commit tested | \`$HEAD_SHA" "$OUT/report.md" && grep -q "Based on | \`$MAIN" "$OUT/report.md"; then
    say "#$PR: full run is on $HEAD_SHA over current main; no re-verify needed"
    gh pr comment $PR --body-file "$OUT/report.md" >/dev/null
  # already re-verified on this exact commit, on this exact main?
  elif [ -f "$RV" ] && grep -q '^## ✅' "$RV" && grep -q "Commit tested | \`$HEAD_SHA" "$RV" && grep -q "Based on | \`$MAIN" "$RV"; then
    say "#$PR: already green on $HEAD_SHA over main ${MAIN:0:8}"
  else
    say "#$PR: rebasing onto main ${MAIN:0:8} and re-verifying"
    "$CI/reverify.sh" $PR | tail -3
    HEAD_SHA=$(gh pr view $PR --json headRefOid --jq .headRefOid)
    grep -q '^## ✅' "$RV" && grep -q "Commit tested | \`$HEAD_SHA" "$RV" \
      || { say "#$PR: re-verify not green on the PR head; stopping the train"; exit 2; }
  fi
  title=$(gh pr view $PR --json title --jq .title)
  if gh pr merge $PR --squash --match-head-commit "$HEAD_SHA" --subject "$title (#$PR)" >/dev/null 2>&1; then
    say "#$PR MERGED at ${HEAD_SHA:0:8}"
  else
    say "#$PR: merge refused (head moved or conflicts); stopping the train"; exit 3
  fi
done
say "TRAIN DONE"
