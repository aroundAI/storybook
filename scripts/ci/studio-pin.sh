#!/usr/bin/env bash
#
# Moves the storybookstudio submodule pin to the fork's main and writes the
# pull request it needs (.github/workflows/studio-pin.yml opens it). A
# submodule always records one commit; this is how that commit follows fork
# main without anyone bumping it by hand.
#
#   scripts/ci/studio-pin.sh <out-dir>
#
# Prints `unchanged <sha>` when the pin already is fork main, otherwise
# `bumped <old> <new>`, leaves the submodule checked out at <new> (the
# working tree change to commit), and writes <out-dir>/title, body.md and
# commit.txt. It commits and pushes nothing.
set -euo pipefail

out=${1:?usage: studio-pin.sh <out-dir>}
mkdir -p "$out"
cd "$(git rev-parse --show-toplevel)"

old=$(git ls-tree HEAD storybookstudio | awk '{print $3}')
[ -n "$old" ] || { echo 'storybookstudio is not a submodule at HEAD' >&2; exit 1; }

# .gitmodules names the fork over SSH, and a CI runner has no key; the fork
# is public, so read it over HTTPS. Exported, not passed with -c: a blobless
# clone fetches contents lazily from later commands (the checkout below), and
# each of those must read over HTTPS too.
n=${GIT_CONFIG_COUNT:-0}
export "GIT_CONFIG_KEY_$n=url.https://github.com/.insteadOf" "GIT_CONFIG_VALUE_$n=git@github.com:"
export GIT_CONFIG_COUNT=$((n + 1))

# Blobless: the merge subjects between the two pins are all that is read.
git submodule update --init --filter=blob:none storybookstudio >/dev/null 2>&1 \
  || git submodule update --init storybookstudio >/dev/null
git -C storybookstudio fetch --quiet --filter=blob:none origin main
new=$(git -C storybookstudio rev-parse FETCH_HEAD)

if [ "$old" = "$new" ]; then
  echo "unchanged $new"
  exit 0
fi
git -C storybookstudio checkout --quiet "$new"

# One line per fork PR merged since the old pin: "#34 <its title>". A merge
# commit's subject names the PR and its body's first line is the title.
merged=$(git -C storybookstudio log --merges --first-parent --reverse --format='%s%x1f%b%x1e' "$old..$new" \
  | awk 'BEGIN { RS = "\036"; FS = "\037" }
    match($1, /#[0-9]+/) {
      n = split($2, body, "\n"); title = ""
      for (i = 1; i <= n; i++) if (body[i] ~ /[^[:space:]]/) { title = body[i]; break }
      if (title == "") title = $1
      printf "- aroundAI/storybookstudio%s %s\n", substr($1, RSTART, RLENGTH), title
    }')
[ -n "$merged" ] || merged="- no pull request merges between the two pins (direct commits only)"

short=${new:0:7}
printf 'chore(storybookstudio): the pin follows fork main to %s\n' "$short" >"$out/title"
{
  printf 'chore(storybookstudio): the pin follows fork main to %s\n\n' "$short"
  printf 'Moves the pin from %s to %s, fork main. Opened by\n' "${old:0:7}" "$short"
  printf '.github/workflows/studio-pin.yml.\n'
} >"$out/commit.txt"
cat >"$out/body.md" <<BODY
## What
The storybookstudio pin moves from ${old:0:7} to ${short}, the fork's main. Fork pull requests merged since the last pin:

${merged}

## Why
StoryBook pins one fork commit; this pull request keeps that commit at fork main (\`.github/workflows/studio-pin.yml\`, on every fork main merge and daily). It changes the pin only.

## Evidence
CI never checks the submodule out, and \`scripts/ci/scope-heavy.sh\` runs no heavy job for a pin-only change.

## Records updated
None. A pin bump changes no criterion; the specs the merged fork pull requests advance are recorded by their own records pull request.
BODY
echo "bumped $old $new"
