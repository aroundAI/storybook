#!/usr/bin/env bash
#
# Table test for scripts/ci/code-patch-unchanged.sh, on a throwaway repo.
# Each case builds a PR head before and after a push and states whether the
# PR's code patch must count as unchanged.
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/code-patch-unchanged.sh"
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"

git init -q -b main
git config user.email ci@example.com
git config user.name ci
git config commit.gpgsign false

mkdir -p src specs
seq 1 20 | sed 's/^/line /' > src/app.ts
printf '| KB | Fixed in |\n|---|---|\n| KB-1 | #1 |\n' > specs/bugs.md
git add . && git commit -qm base
base0=$(git rev-parse HEAD)

# The PR as first pushed: one code edit and one appended table row.
pr_changes() {
  sed -i.bak 's/^line 5$/line 5 changed by the PR/' src/app.ts && rm src/app.ts.bak
  printf '| KB-2 | #2 |\n' >> specs/bugs.md
}
git checkout -q -b pr "$base0"
pr_changes
git commit -qam pr
prev=$(git rev-parse HEAD)

# main moves on, and so collides with the PR's table row.
git checkout -q main
printf '| KB-3 | #3 |\n' >> specs/bugs.md
git commit -qam 'main: another fixed row'
main1=$(git rev-parse HEAD)

# The PR rebased onto main1, table conflict resolved by keeping both rows.
rebased_head() {
  git checkout -q -B "tmp-$1" "$2"
  pr_changes
}

failures=0
check() {
  local expected=$1 label=$2 p=$3 h=$4 b=$5
  local actual
  actual=$(bash "$script" "$p" "$h" "$b" | sed -n 's/^unchanged=//p')
  if [ "$actual" = "$expected" ]; then
    echo "ok    $label -> unchanged=$actual"
  else
    echo "FAIL  $label -> unchanged=$actual (expected $expected)"
    bash "$script" "$p" "$h" "$b" | sed 's/^/        /'
    failures=$((failures + 1))
  fi
}

# 1. Rebase plus a docs-only conflict resolution.
rebased_head a "$main1"; git commit -qam 'pr, rebased'
check true 'rebase, docs conflict resolved' "$prev" "$(git rev-parse HEAD)" "$main1"

# 2. The same, but the push also edits a code line.
rebased_head b "$main1"
sed -i.bak 's/^line 15$/line 15 also changed/' src/app.ts && rm src/app.ts.bak
git commit -qam 'pr, rebased, more code'
check false 'rebase plus a code edit' "$prev" "$(git rev-parse HEAD)" "$main1"

# 3. A new code file in the push.
rebased_head c "$main1"; echo 'export {}' > src/new.ts; git add src/new.ts
git commit -qm 'pr, rebased, new file'
check false 'new code file' "$prev" "$(git rev-parse HEAD)" "$main1"

# 4. main edits the PR's code line; the conflict is resolved in code, taking
# the PR's side of it. Files are written whole so the setup cannot drift.
write_app() { seq 1 20 | sed 's/^/line /' | sed "s/^line 5$/$1/" > src/app.ts; }
git checkout -q -B main2 "$main1"
write_app 'line 5 changed on main'
git commit -qam 'main edits line 5'
main2=$(git rev-parse HEAD)
git checkout -q -B tmp-d "$main2"
write_app 'line 5 changed by the PR'
printf '| KB-2 | #2 |\n' >> specs/bugs.md
git commit -qam 'pr, conflict resolved in code'
# Guard the setup itself: the head must differ from main2 in code.
if git diff --quiet "$main2" HEAD -- src/app.ts; then
  echo "FAIL  case 4 setup: head has no code change against main2"
  failures=$((failures + 1))
fi
check false 'conflict resolved inside a code file' "$prev" "$(git rev-parse HEAD)" "$main2"

# 5. main edits a context line next to the PR's hunk.
git checkout -q -B main3 "$main1"
sed -i.bak 's/^line 6$/line 6 changed on main/' src/app.ts && rm src/app.ts.bak
git commit -qam 'main edits line 6'
main3=$(git rev-parse HEAD)
rebased_head e "$main3"; git commit -qam 'pr on main3'
check false 'main changed the hunk context' "$prev" "$(git rev-parse HEAD)" "$main3"

# 6. main changes code far from the PR's hunk: still unchanged.
git checkout -q -B main4 "$main1"
echo 'export const x = 1' > src/other.ts; git add src/other.ts
git commit -qm 'main adds unrelated code'
main4=$(git rev-parse HEAD)
rebased_head f "$main4"; git commit -qam 'pr on main4'
check true 'main changed unrelated code' "$prev" "$(git rev-parse HEAD)" "$main4"

# 7. Updated by merging main instead of rebasing.
git checkout -q -B tmp-g "$prev"
git merge -q --no-edit "$main1" >/dev/null 2>&1 || true
printf '| KB | Fixed in |\n|---|---|\n| KB-1 | #1 |\n| KB-2 | #2 |\n| KB-3 | #3 |\n' > specs/bugs.md
git add specs/bugs.md
git -c core.editor=true commit -q --no-edit 2>/dev/null || git commit -qm 'merge main'
check true 'merge from main, docs conflict resolved' "$prev" "$(git rev-parse HEAD)" "$main1"

# 8. The previous head is not available.
check false 'previous head missing' 1234567890abcdef1234567890abcdef12345678 "$(git rev-parse tmp-a)" "$main1"
check false 'previous head all zeros' 0000000000000000000000000000000000000000 "$(git rev-parse tmp-a)" "$main1"

# 9. A PR with no code at all is docs-only.sh's case, not this one.
git checkout -q -B docs-pr "$base0"
printf '| KB-9 | #9 |\n' >> specs/bugs.md; git commit -qam 'docs pr'
docs_prev=$(git rev-parse HEAD)
git checkout -q -B docs-pr2 "$main1"
printf '| KB-9 | #9 |\n' >> specs/bugs.md; git commit -qam 'docs pr rebased'
check false 'no code paths' "$docs_prev" "$(git rev-parse HEAD)" "$main1"

# 10. The script's own usage error.
actual=$(bash "$script" only-one-arg | sed -n 's/^unchanged=//p')
if [ "$actual" = false ]; then echo "ok    wrong arguments -> unchanged=false"
else echo "FAIL  wrong arguments -> unchanged=$actual"; failures=$((failures + 1)); fi

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
