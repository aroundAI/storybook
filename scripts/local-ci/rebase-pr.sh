#!/bin/bash
# rebase-pr.sh <pr-number>: rebase a PR branch onto origin/main in a worktree,
# auto-resolving only FILM-CC-04 append conflicts. Stops on anything else.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
n=$1; repo=$MAINROOT
cd $repo
br=$(gh pr view $n --json headRefName --jq .headRefName); old=$(gh pr view $n --json headRefOid --jq .headRefOid)
git fetch -q origin "$br" main
wt=$(git worktree list | grep "\[$br\]" | awk '{print $1}')
if [ -z "$wt" ]; then wt=$STATE/worktrees/pr-$n; git worktree add -q -B "$br" "$wt" "origin/$br" || exit 1; fi
cd "$wt"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "#$n DIRTY worktree $wt"; exit 1; fi
git checkout -q "$br" && git reset -q --hard "$old"
git rebase origin/main >/dev/null 2>&1
while [ -d .git/rebase-merge ] || [ -d "$(git rev-parse --git-dir)/rebase-merge" ]; do
  conflicted=$(git diff --name-only --diff-filter=U)
  rest=$(printf '%s\n' $conflicted | grep -vx -e specs/cross-cutting/FILM-CC-04-known-bugs.md -e specs/INDEX.md)
  if [ -z "$rest" ]; then
    for f in $conflicted; do git checkout --ours "$f"; git add "$f"; done
    GIT_EDITOR=true git rebase --continue >/dev/null 2>&1
  else
    echo "#$n STOPPED on: $(echo $conflicted | tr '\n' ' ') (worktree $wt)"; exit 2
  fi
done
bash $CI/remerge-known-bugs.sh "$old" || { echo "#$n REMERGE FAILED"; exit 3; }
if ! git diff --quiet "$old" -- specs/INDEX.md 2>/dev/null && [ -n "$(git diff $(git merge-base $old origin/main) $old -- specs/INDEX.md)" ]; then python3 $CI/remerge-index.py "$old" || { echo "#$n INDEX REMERGE FAILED"; exit 3; }; git diff --quiet -- specs/INDEX.md || { git add specs/INDEX.md; git commit -qm "docs(INDEX): re-apply this PR's rows onto main after the rebase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; }; fi
# Task #15: once the INDEX generator is on the branch, recount INDEX's counts from the
# spec files, so the delta arithmetic above is corrected rather than trusted. It never
# edits a status cell; what it cannot fix fails the unit suite at re-verify.
if grep -q '"specs:index"' package.json 2>/dev/null; then
  pnpm specs:index --write >/dev/null 2>&1
  if ! git diff --quiet -- specs/INDEX.md; then git add specs/INDEX.md; git commit -qm "docs(INDEX): recount after the rebase (pnpm specs:index --write)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; echo "#$n INDEX counts rewritten"; fi
fi
# KB-81 (#349): once the citation checker is on the branch, re-point citations that moved
if grep -q '"specs:citations"' package.json 2>/dev/null; then
  pnpm specs:citations --fix >/dev/null 2>&1
  if ! git diff --quiet -- specs; then git add specs; git commit -qm "docs(specs): re-point citations that moved after the rebase (pnpm specs:citations --fix)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; echo "#$n citations re-pointed"; fi
fi
echo "#$n rebased: $(git log --oneline -1 | cut -c1-70)"
echo "#$n $(bash scripts/ci/code-patch-unchanged.sh "$old" HEAD origin/main | tr '\n' ' ')"
echo "OLD=$old BR=$br WT=$wt"
