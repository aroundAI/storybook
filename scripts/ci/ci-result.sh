#!/usr/bin/env bash
#
# The verdict of ✅ CI result, the one required check (merge queue, 2026-10-01).
# Reads the workflow's `needs` context as JSON on stdin (toJSON(needs)) and
# exits 0 only when:
#   1. 🔎 Changes succeeded — a failed classifier must not skip everything;
#   2. no needed job failed or was cancelled — a cancelled queue run must not
#      merge;
#   3. every job this run requires ran and succeeded. On the docs-only path
#      (code=false) that is 📚 Docs checks. Otherwise it is the fast lane
#      (typecheck, format, unit tests, ClickHouse SQL), plus the heavy jobs
#      that do not depend on vars.ENABLE_E2E_JOB when heavy=true (the merge
#      queue and a dispatch): 🐘 Supabase DB and 🧪 Unit guards.
# Any other job may be skipped: that is how the fast lane and the E2E switch
# work. Table test: scripts/ci/ci-result.test.sh.
set -euo pipefail

needs=$(cat)

result() { printf '%s' "$needs" | jq -r --arg j "$1" '.[$j].result // "missing"'; }
output() { printf '%s' "$needs" | jq -r --arg j "$1" --arg o "$2" '.[$j].outputs[$o] // ""'; }

printf '%s' "$needs" | jq -r 'to_entries[] | "\(.key): \(.value.result)"'

if [ "$(result changes)" != success ]; then
  echo "FAIL: 🔎 Changes did not succeed, so nothing below it can be trusted."
  exit 1
fi

bad=$(printf '%s' "$needs" | jq -r 'to_entries[] | select(.value.result == "failure" or .value.result == "cancelled") | .key')
if [ -n "$bad" ]; then
  echo "FAIL: failed or cancelled: $(printf '%s' "$bad" | tr '\n' ' ')"
  exit 1
fi

code=$(output changes code)
heavy=$(output changes heavy)
if [ "$code" = false ]; then
  required=(docs-checks)
else
  required=(typescript format clickhouse-sql unit-test)
  if [ "$heavy" = true ]; then
    required+=(supabase-db unit-guards unit-guards-result)
  fi
fi

missing=()
for job in "${required[@]}"; do
  if [ "$(result "$job")" != success ]; then
    missing+=("$job=$(result "$job")")
  fi
done
if [ "${#missing[@]}" -ne 0 ]; then
  echo "FAIL: required for code=$code heavy=$heavy but did not succeed: ${missing[*]}"
  exit 1
fi

echo "PASS: code=$code heavy=$heavy; every required job succeeded."
