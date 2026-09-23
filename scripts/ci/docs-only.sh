#!/usr/bin/env bash
#
# Decides whether a change needs the full CI suite. Reads a list of changed
# paths (one per line, as `git diff --name-only` prints them) on stdin and
# prints `code=true` or `code=false`, ready to append to $GITHUB_OUTPUT.
#
# code=false only when the list is non-empty and every path is prose:
#   - a Markdown file (`**/*.md`) outside .github/
#   - anything under specs/ (the spec YAMLs and their Markdown)
#   - anything under docs/
# Everything else is code=true: an empty list (nothing to go on), anything
# under .github/ (a workflow change must run the workflow), and every other
# .json or .yaml. Those are not docs here: package.json, tsconfig, the
# prompt-engine prompts, the mutation guards, the locales, the lockfile and
# turbo.json are all read by a build or a test. Editing this script is code
# too, so a change to the rule always runs the full suite.
#
# Test: scripts/ci/docs-only.test.sh.
set -euo pipefail

count=0
code=false
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  count=$((count + 1))
  case "$path" in
    .github/*) code=true ;;
    docs/*) ;;
    specs/*) ;;
    *.md) ;;
    *) code=true ;;
  esac
done

if [ "$count" -eq 0 ]; then
  code=true
fi
echo "code=$code"
