#!/usr/bin/env bash
#
# Did a push to a pull request leave the PR's *code* exactly as it was?
#
#   code-patch-unchanged.sh <prev-head> <new-head> <base>
#
# Prints `unchanged=true` or `unchanged=false`, then a `reason=` line.
#
# The PR's code patch is its diff from the merge-base with <base>, restricted
# to the paths scripts/ci/docs-only.sh calls code. The two patches are compared
# by `git patch-id --stable`, which ignores line numbers: a rebase or a merge
# from main that only moved the PR's hunks keeps the id. Anything that changes
# a code hunk, its context lines included, changes the id. That covers a
# conflict resolved inside a code file, and main editing lines next to the
# PR's changes.
#
# Every doubt answers `unchanged=false`, and the caller then runs the full
# suite: a missing commit, a failed git command, or no code paths at all
# (a PR that is docs-only throughout is docs-only.sh's case, not this one).
# Whether the previous head's run passed is the caller's check, not this
# script's.
#
# Test: scripts/ci/code-patch-unchanged.test.sh.
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

answer() {
  echo "unchanged=$1"
  echo "reason=$2"
  exit 0
}

[ $# -eq 3 ] || answer false "usage: code-patch-unchanged.sh <prev> <head> <base>"
prev=$1 head=$2 base=$3

for sha in "$prev" "$head" "$base"; do
  if [ -z "$sha" ] || [ -z "${sha//0/}" ] \
    || ! git cat-file -e "$sha^{commit}" 2>/dev/null; then
    answer false "commit '$sha' is not available"
  fi
done

mb_prev=$(git merge-base "$prev" "$base") || answer false "no merge-base for $prev"
mb_head=$(git merge-base "$head" "$base") || answer false "no merge-base for $head"

files_prev=$(git diff --name-only --no-renames "$mb_prev" "$prev") \
  || answer false "git diff failed for $prev"
files_head=$(git diff --name-only --no-renames "$mb_head" "$head") \
  || answer false "git diff failed for $head"

# Keep the paths docs-only.sh calls code, one at a time so the rule lives in
# one place.
code_paths=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if [ "$(printf '%s\n' "$path" | bash "$here/docs-only.sh")" = "code=true" ]; then
    code_paths+=("$path")
  fi
done < <(printf '%s\n%s\n' "$files_prev" "$files_head" | sort -u)

[ ${#code_paths[@]} -gt 0 ] || answer false "no code paths in the PR"

patch_id() {
  git diff --no-renames "$1" "$2" -- "${code_paths[@]}" \
    | git patch-id --stable | cut -d' ' -f1
}

id_prev=$(patch_id "$mb_prev" "$prev") || answer false "patch-id failed for $prev"
id_head=$(patch_id "$mb_head" "$head") || answer false "patch-id failed for $head"

[ -n "$id_prev" ] && [ -n "$id_head" ] || answer false "empty code patch"

if [ "$id_prev" = "$id_head" ]; then
  answer true "code patch unchanged (${#code_paths[@]} code paths, patch-id $id_head)"
fi
answer false "code patch changed"
