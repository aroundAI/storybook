#!/usr/bin/env bash
#
# Table test for scripts/ci/ci-result.sh. Each case builds a `needs` context
# from `job=result` pairs (code and heavy are 🔎 Changes' outputs) and states
# whether ✅ CI result must pass or fail.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

needs() {
  local code=$1 heavy=$2
  shift 2
  local json
  # SCOPE: extra 🔎 Changes outputs as JSON, for the enforced scope (Phase 2).
  local scope=${SCOPE:-}
  [ -n "$scope" ] || scope='{}'
  json=$(jq -n --arg code "$code" --arg heavy "$heavy" --argjson scope "$scope" \
    '{changes: {result: "success", outputs: ({code: $code, heavy: $heavy} + $scope)}}')
  for pair in "$@"; do
    json=$(printf '%s' "$json" | jq --arg j "${pair%%=*}" --arg r "${pair#*=}" \
      'if $j == "changes" then .changes.result = $r else .[$j] = {result: $r, outputs: {}} end')
  done
  printf '%s' "$json"
}

failures=0
check() {
  local expected=$1 label=$2
  shift 2
  local actual=pass
  if ! needs "$@" | bash ./ci-result.sh >/dev/null; then
    actual=fail
  fi
  if [ "$actual" = "$expected" ]; then
    echo "ok    $label -> $actual"
  else
    echo "FAIL  $label -> $actual (expected $expected)"
    failures=$((failures + 1))
  fi
}

FAST=(typescript=success format=success clickhouse-sql=success unit-test=success)
SKIPPED_HEAVY=(next-build=skipped supabase-db=skipped unit-guards=skipped unit-guards-result=success
  docs-checks=skipped e2e-guards=skipped e2e-evidence=skipped test=skipped)
FULL=(next-build=success supabase-db=success unit-guards=success unit-guards-result=success
  docs-checks=skipped e2e-guards=success e2e-evidence=success test=success)
DOCS=(typescript=skipped format=skipped clickhouse-sql=skipped unit-test=skipped
  next-build=skipped supabase-db=skipped unit-guards=skipped unit-guards-result=success
  e2e-guards=skipped e2e-evidence=skipped test=skipped)

check pass 'PR fast lane green, heavy jobs skipped' true false "${FAST[@]}" "${SKIPPED_HEAVY[@]}"
check fail 'PR fast lane with a failed typecheck' true false "${FAST[@]}" "${SKIPPED_HEAVY[@]}" typescript=failure
check fail 'PR fast lane with a skipped unit test' true false "${FAST[@]}" "${SKIPPED_HEAVY[@]}" unit-test=skipped
check pass 'docs-only PR, docs checks green' false false "${DOCS[@]}" docs-checks=success
check fail 'docs-only PR, docs checks failed' false false "${DOCS[@]}" docs-checks=failure
check fail 'docs-only PR, docs checks skipped' false false "${DOCS[@]}" docs-checks=skipped
check pass 'queue run, every job green' true true "${FAST[@]}" "${FULL[@]}"
check pass 'queue run, E2E switched off' true true "${FAST[@]}" "${FULL[@]}" e2e-guards=skipped e2e-evidence=skipped test=skipped
check fail 'queue run, ⚫️ Test failed' true true "${FAST[@]}" "${FULL[@]}" test=failure
check fail 'queue run, E2E guards cancelled' true true "${FAST[@]}" "${FULL[@]}" e2e-guards=cancelled
check fail 'queue run, Supabase DB skipped' true true "${FAST[@]}" "${FULL[@]}" supabase-db=skipped
check fail 'queue run, Next build failed' true true "${FAST[@]}" "${FULL[@]}" next-build=failure
check fail 'queue run, Next build cancelled' true true "${FAST[@]}" "${FULL[@]}" next-build=cancelled
check fail 'queue run, Next build skipped without a scope' true true "${FAST[@]}" "${FULL[@]}" next-build=skipped
check fail 'queue run, Next build missing from needs' true true "${FAST[@]}" "${FULL[@]}" next-build=missing
check fail 'queue run, unit guards skipped' true true "${FAST[@]}" "${FULL[@]}" unit-guards=skipped
check fail 'queue run, unit guards result failed' true true "${FAST[@]}" "${FULL[@]}" unit-guards-result=failure
check pass 'docs-only queue run' false true "${DOCS[@]}" docs-checks=success
check fail 'Changes failed' true true "${FAST[@]}" "${FULL[@]}" changes=failure
check fail 'Changes cancelled' true true "${FAST[@]}" "${FULL[@]}" changes=cancelled
check fail 'Changes succeeded with no classification, all skipped' '' '' \
  typescript=skipped format=skipped clickhouse-sql=skipped unit-test=skipped \
  docs-checks=skipped supabase-db=skipped unit-guards=skipped

# Phase 2: an enforced scope may skip 🏗️ Next build, 🐘 Supabase DB and 🧪 Unit guards.
SCOPE='{"skip_build": "true"}' check pass 'scoped queue run, Next build scoped out' true true \
  "${FAST[@]}" "${FULL[@]}" next-build=skipped
SCOPE='{"skip_build": "true"}' check fail 'scoped out, but the build ran and failed' true true \
  "${FAST[@]}" "${FULL[@]}" next-build=failure
SCOPE='{"skip_build": "false"}' check fail 'build scoped in, but skipped' true true \
  "${FAST[@]}" "${FULL[@]}" next-build=skipped
SCOPED='{"skip_supabase": "true", "skip_unit_guards": "true"}'
SCOPE=$SCOPED check pass 'scoped queue run, DB and unit guards scoped out' true true \
  "${FAST[@]}" "${FULL[@]}" supabase-db=skipped unit-guards=skipped e2e-guards=skipped
SCOPE=$SCOPED check fail 'scoped queue run, a scoped-in job failed' true true \
  "${FAST[@]}" "${FULL[@]}" supabase-db=skipped unit-guards=skipped test=failure
SCOPE=$SCOPED check fail 'scoped out, but it ran and failed' true true \
  "${FAST[@]}" "${FULL[@]}" supabase-db=failure unit-guards=skipped
SCOPE=$SCOPED check fail 'scoped out, unit guards result failed' true true \
  "${FAST[@]}" "${FULL[@]}" supabase-db=skipped unit-guards=skipped unit-guards-result=failure
SCOPE='{"skip_supabase": "true", "skip_unit_guards": "false"}' check fail \
  'unit guards scoped in, but skipped' true true "${FAST[@]}" "${FULL[@]}" supabase-db=skipped unit-guards=skipped
SCOPE='{"skip_supabase": "", "skip_unit_guards": ""}' check fail \
  'blank scope (report-only or failed), DB skipped' true true "${FAST[@]}" "${FULL[@]}" supabase-db=skipped

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
