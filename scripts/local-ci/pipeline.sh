#!/bin/bash
# pipeline.sh <pr> [<pr>...]: full local CI for each PR, overlapping PRs.
# Static jobs: 2 PRs at a time. Services: one PR at a time, in the order given.
set -u; . "$(dirname "${BASH_SOURCE[0]}")/env.sh"; R=$MAINROOT
cd $R; git fetch -q origin
for pr in "$@"; do
  br=$(gh pr view $pr --json headRefName --jq .headRefName); sha=$(gh pr view $pr --json headRefOid --jq .headRefOid)
  wt=$(git worktree list | grep "\[$br\]" | awk '{print $1}')
  if [ -z "$wt" ]; then
    wt=$STATE/worktrees/pr-$pr
    git worktree add -q -B "$br" "$wt" "origin/$br" || { echo "#$pr: failed to create worktree for $br"; exit 1; }
  fi
  [ "$(git -C "$wt" rev-parse HEAD)" = "$sha" ] || { echo "#$pr: worktree HEAD differs from the PR head $sha"; exit 1; }
  [ -z "$(git -C "$wt" status --porcelain --untracked-files=no)" ] || { echo "#$pr: worktree has changes"; exit 1; }
  rm -rf "$STATE/runs/$pr"; mkdir -p "$STATE/runs/$pr"; echo "$wt" > "$STATE/runs/$pr/worktree"
done
# one PR at a time, static then services: overlapping them exhausted memory
for pr in "$@"; do
  wt=$(cat $STATE/runs/$pr/worktree)
  # static stages run one at a time across both lanes: two at once, next to a
  # lane's E2E suite, starved the Mac and timed tests out (lane B, #360).
  # Service stages hold only their own lane's lock, so they may overlap.
  until mkdir "$STATE/static.lock" 2>/dev/null; do sleep 10; done
  trap 'rmdir "$STATE/static.lock" 2>/dev/null' EXIT
  "$CI/static.sh" $pr "$wt" "$STATE/runs/$pr"
  rmdir "$STATE/static.lock"; trap - EXIT
  docker info >/dev/null 2>&1 || { echo "#$pr: Docker is down; stopping"; exit 2; }
  "$CI/services.sh" $pr "$wt" "$STATE/runs/$pr"
  docker info >/dev/null 2>&1 || { echo "#$pr: Docker went down during services; report not trustworthy; stopping"; exit 2; }
  "$CI/report.sh" $pr "$wt" "$STATE/runs/$pr"
done
wait
echo "PIPELINE DONE"
