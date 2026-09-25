#!/bin/bash
# remerge-known-bugs.sh <old-pr-head-sha>
# Run in a PR worktree right after `git rebase origin/main` finished, with every
# FILM-CC-04 conflict resolved as `git checkout --ours` (main's side).
# Rewrites the file as ONE 3-way union: main's version + the PR's own changes
# (merge-base -> old head), keeping both sides of each append verbatim. Then
# checks it and commits it.
set -euo pipefail
old=$1; F=specs/cross-cutting/FILM-CC-04-known-bugs.md
base=$(git merge-base "$old" origin/main)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git show "origin/main:$F" > "$tmp/main"; git show "$base:$F" > "$tmp/base" 2>/dev/null || : > "$tmp/base"
git show "$old:$F" > "$tmp/pr"
cp "$tmp/main" "$tmp/out"
git merge-file --union "$tmp/out" "$tmp/base" "$tmp/pr" || true
python3 - "$tmp/out" <<'PY'
import sys,re
p=sys.argv[1]; L=open(p).read().split('\n'); out=[]
for i,l in enumerate(L):
    # an entry heading must follow a `---` separator and a blank line
    if re.match(r'^## KB-\d+ ', l):
        prev=[x for x in out if x.strip()!='']
        if prev and prev[-1].strip()!='---':
            while out and out[-1].strip()=='': out.pop()
            out+=['','---','']
    out.append(l)
open(p,'w').write('\n'.join(out))
PY
# checks
if grep -qE '^(<<<<<<<|=======$|>>>>>>>)' "$tmp/out"; then echo "FAIL: markers"; exit 1; fi
dups=$(comm -13 <(grep -oE '^## KB-[0-9]+ ' "$tmp/main" | sort | uniq -d) <(grep -oE '^## KB-[0-9]+ ' "$tmp/out" | sort | uniq -d))
[ -z "$dups" ] || { echo "FAIL: duplicate entries: $dups"; exit 1; }
rowkeys(){ grep -oE '^\| KB-[0-9, ()a-z-]+ \|' "$1" | sort | uniq -c; }
rows=$(comm -13 <(rowkeys "$tmp/main") <(rowkeys "$tmp/out") | awk '$1>1' || true)
[ -z "$rows" ] || { echo "FAIL: duplicate Fixed rows: $rows"; exit 1; }
# every line main has, and every line the PR added, must survive
removed=$( { diff "$tmp/base" "$tmp/pr" || true; } | grep '^<' | sed 's/^< //' | sort -u || true)
miss=$(comm -23 <(sort -u "$tmp/main") <(sort -u "$tmp/out") | grep -v '^$' || true)
miss=$(comm -23 <(printf '%s\n' "$miss") <(printf '%s\n' "$removed") | grep -v '^$' || true)
[ -z "$miss" ] || { echo "FAIL: lines of main lost:"; echo "$miss" | head; exit 1; }
added=$( { diff "$tmp/base" "$tmp/pr" || true; } | grep '^>' | sed 's/^> //' | sort -u || true)
lost=$(comm -23 <(printf '%s\n' "$added") <(sort -u "$tmp/out") | grep -v '^$' || true)
[ -z "$lost" ] || { echo "FAIL: PR lines lost:"; echo "$lost" | head; exit 1; }
cp "$tmp/out" "$F"
if git diff --quiet -- "$F"; then echo "known-bugs: nothing to change"; exit 0; fi
git add "$F"
git commit -q -m "docs(FILM-CC-04): re-merge this PR's records onto main after the rebase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
echo "known-bugs re-merged: +$(git diff --numstat HEAD~1 -- "$F" | cut -f1) -$(git diff --numstat HEAD~1 -- "$F" | cut -f2) vs the rebased file"
