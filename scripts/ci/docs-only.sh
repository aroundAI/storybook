#!/usr/bin/env bash
#
# Reads changed file paths on stdin, one per line, and prints `code=false`
# when the change is documentation only, `code=true` otherwise. The `changes`
# job in .github/workflows/workflow.yml appends this to $GITHUB_OUTPUT, and
# the heavy jobs run only when code=true.
#
# Documentation is `**/*.md`, `specs/**` and `docs/**`, nothing else.
# `.json` and `.yaml` are not documentation here: package manifests,
# tsconfigs, prompt-engine prompts, mutation guards, locales and the lockfile
# are all JSON or YAML. Anything unrecognised, and an empty list, is code:
# this fails towards running the full suite.
#
# Editing this file or the workflow is itself a code change, so it always
# gets the full suite.
set -euo pipefail

docs=0
code=0
while IFS= read -r path || [ -n "$path" ]; do
  [ -z "$path" ] && continue
  case "$path" in
    *.md | specs/* | docs/*) docs=$((docs + 1)) ;;
    *) code=$((code + 1)) ;;
  esac
done

if [ "$docs" -gt 0 ] && [ "$code" -eq 0 ]; then
  echo 'code=false'
else
  echo 'code=true'
fi
