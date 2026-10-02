#!/usr/bin/env bash
#
# Table test for scripts/ci/scope-heavy.sh. Each case is a list of changed
# paths, turbo's affected set (SCOPE_AFFECTED, `?` when turbo failed), the
# changed-guard counts run.py --changed reports, and the keys the classifier
# must print. A case states only the keys it is about.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

failures=0
# check <label> <expected "k=v k=v"> <path>...   (env: SCOPE_*)
check() {
  local label=$1 expected=$2
  shift 2
  local actual want
  actual=$(printf '%s\n' "$@" | bash ./scope-heavy.sh --classify)
  for want in $expected; do
    if ! printf '%s\n' "$actual" | grep -qxF -- "$want"; then
      echo "FAIL  $label: wanted $want, got: $(printf '%s' "$actual" | grep -F "${want%%=*}=" | tr '\n' ' ')"
      failures=$((failures + 1))
      return
    fi
  done
  echo "ok    $label"
}

# Defaults for every case: enforcing, nothing affected, no guard selected.
export SCOPE_ENFORCE=true SCOPE_AFFECTED='' SCOPE_UNIT_GUARDS=0 SCOPE_E2E_GUARDS=0 SCOPE_PGTAP_GUARDS=0

SKIP_ALL='full=false test=false supabase=false skip_test=true skip_supabase=true skip_unit_guards=true skip_e2e_guards=true enforced=true'
RUN_ALL='full=true skip_test=false skip_supabase=false skip_unit_guards=false skip_e2e_guards=false enforced=false unit_shards=[1,2,3,4,5,6] e2e_shards=[1,2,3,4,5]'

# --- what nothing reaches is skipped
check 'specs and a script outside scripts/ci' "$SKIP_ALL" specs/INDEX.md scripts/local-ci/stop.sh
check 'a package web does not depend on' "$SKIP_ALL" packages/sandbox/src/a.ts
SCOPE_AFFECTED='@kit/sandbox' check '... named by turbo' "$SKIP_ALL" packages/sandbox/src/a.ts
check 'guard README is prose' "$SKIP_ALL" tooling/mutation-guards/README.md
check 'a nested package.json is the graph, not root config' 'full=false' packages/shared/package.json

# --- Playwright follows turbo's affected set
SCOPE_AFFECTED=$'@kit/shared\nweb' check 'a package web depends on' 'test=true skip_test=false supabase=false skip_supabase=true' packages/shared/src/a.ts
SCOPE_AFFECTED='@kit/shared web' check 'names separated by spaces' 'test=true' packages/shared/src/a.ts
SCOPE_AFFECTED='web-e2e' check 'an E2E spec only' 'test=true skip_test=false' apps/e2e/tests/x.spec.ts
SCOPE_AFFECTED='webby web-e2ee' check 'names must match whole' 'test=false skip_test=true' packages/x/a.ts

# --- Supabase DB follows SQL and what its steps read
SCOPE_AFFECTED=web check 'a migration' 'supabase=true skip_supabase=false test=true' apps/web/supabase/migrations/20261001000000_x.sql
check 'a pgTAP test' 'supabase=true' apps/web/supabase/tests/database/x.test.sql
check 'the Supabase package' 'supabase=true' packages/supabase/src/clients/x.ts
check 'the app copy of the generated types' 'supabase=true' apps/web/lib/database.types.ts
check 'the schema-drift check' 'supabase=true' apps/web/scripts/check-schema-drift.ts
check 'the canon memory builder' 'supabase=true' packages/features/episodes/src/lib/canon/memory-context-builder.ts
check 'the canon verify script' 'supabase=true' packages/features/episodes/scripts/verify-memory-context.ts
check 'the E2E seed helpers it imports' 'supabase=true' apps/e2e/tests/utils/seed.ts
SCOPE_PGTAP_GUARDS=2 check 'a guard JSON with pgTAP entries' 'full=false supabase=true skip_supabase=false' tooling/mutation-guards/kb-13.json

# --- guards follow run.py --changed
SCOPE_UNIT_GUARDS=3 check 'three unit guards: three shards' 'full=false unit_guards=3 skip_unit_guards=false unit_shards=[1,2,3] skip_e2e_guards=true' tooling/mutation-guards/kb-13.json
SCOPE_UNIT_GUARDS=40 SCOPE_E2E_GUARDS=2 check 'many unit guards cap at six shards' 'unit_shards=[1,2,3,4,5,6] e2e_guards=2 skip_e2e_guards=false e2e_shards=[1,2]' packages/x/a.ts
SCOPE_E2E_GUARDS=9 check 'E2E guards cap at five shards' 'e2e_shards=[1,2,3,4,5]' apps/e2e/tests/x.spec.ts
check 'no guard: a placeholder shard, never an empty matrix' 'skip_unit_guards=true unit_shards=[1] e2e_shards=[1]' packages/x/a.ts

# --- root config runs everything
check 'root package.json' "$RUN_ALL test=true supabase=true unit_guards=all e2e_guards=all" package.json
check 'the lockfile' "$RUN_ALL" pnpm-lock.yaml
check 'turbo.json' "$RUN_ALL" turbo.json
check 'tsconfig' "$RUN_ALL" tsconfig.json
check 'a root dotfile' "$RUN_ALL" .npmrc
check 'the workflow' "$RUN_ALL" .github/workflows/workflow.yml
check 'Markdown under .github' "$RUN_ALL" .github/pull_request_template.md
check 'the guard runner' "$RUN_ALL" tooling/mutation-guards/run.py
check 'shared tooling config' "$RUN_ALL" tooling/typescript/base.json
check 'a CI script (this classifier)' "$RUN_ALL" scripts/ci/scope-heavy.sh
check 'root config among other changes' "$RUN_ALL" specs/INDEX.md packages/x/a.ts package.json
check 'root Markdown is not config' 'full=false' CLAUDE.md

# --- anything the classifier cannot vouch for runs everything
check 'an empty diff' "$RUN_ALL"
SCOPE_AFFECTED='?' check 'turbo failed' "$RUN_ALL" packages/x/a.ts
SCOPE_UNIT_GUARDS='?' check 'unit guard count unknown' "$RUN_ALL" packages/x/a.ts
SCOPE_E2E_GUARDS='' check 'E2E guard count blank' "$RUN_ALL" packages/x/a.ts
SCOPE_PGTAP_GUARDS='x' check 'pgTAP guard count not a number' "$RUN_ALL" packages/x/a.ts

# --- report-only: the verdict is printed, nothing is skipped
SCOPE_ENFORCE=false check 'report-only skips nothing' 'full=false test=false supabase=false unit_guards=0 enforced=false skip_test=false skip_supabase=false skip_unit_guards=false skip_e2e_guards=false unit_shards=[1,2,3,4,5,6] e2e_shards=[1,2,3,4,5]' specs/INDEX.md
SCOPE_ENFORCE='' check 'switch unset is report-only' 'enforced=false skip_test=false' specs/INDEX.md
SCOPE_ENFORCE=TRUE check 'only the exact value true enforces' 'enforced=false skip_test=false' specs/INDEX.md

# An empty stdin, not one blank line.
empty=$(bash ./scope-heavy.sh --classify </dev/null)
if printf '%s\n' "$empty" | grep -qx 'full=true'; then
  echo "ok    no input at all -> full"
else
  echo "FAIL  no input at all did not run everything"
  failures=$((failures + 1))
fi

# --- the job summary says what was or would be skipped
verdict=$(echo specs/INDEX.md | SCOPE_ENFORCE=false SCOPE_UNIT_GUARDS=2 bash ./scope-heavy.sh --classify)
summary=$(printf '%s\n' "$verdict" | bash ./scope-heavy.sh --summary)
if printf '%s' "$summary" | grep -q 'report-only' \
  && printf '%s' "$summary" | grep -q '| ⚫️ Test, 🧬 E2E evidence | \*\*would skip\*\* |' \
  && printf '%s' "$summary" | grep -q '| 🧪 Unit guards | 2 changed |'; then
  echo "ok    report-only summary names what it would skip"
else
  echo "FAIL  report-only summary: $summary"
  failures=$((failures + 1))
fi
summary=$(printf '%s\n' "$SKIP_ALL" | tr ' ' '\n' | bash ./scope-heavy.sh --summary)
if printf '%s' "$summary" | grep -q 'enforced' && printf '%s' "$summary" | grep -q '| 🐘 Supabase DB | \*\*skipped\*\* |'; then
  echo "ok    enforced summary names what it skipped"
else
  echo "FAIL  enforced summary: $summary"
  failures=$((failures + 1))
fi

# --- the shadow check: a job scoping would have skipped, that failed
shadow() {
  jq -n --arg enforced "$1" --arg test "$2" --arg unit "$3" --arg result "$4" \
    '{changes: {result: "success", outputs: {scope_enforced: $enforced, scope_full: "false",
       scope_test: $test, scope_supabase: "true", scope_unit_guards: $unit, scope_e2e_guards: "1"}},
      test: {result: $result}, "e2e-evidence": {result: "success"}, "supabase-db": {result: "success"},
      "unit-guards": {result: $result}, "e2e-guards": {result: "success"}}' \
    | bash ./scope-heavy.sh --shadow
}
check_shadow() {
  local label=$1 want=$2
  shift 2
  local out
  out=$(shadow "$@")
  if { [ "$want" = missed ] && printf '%s' "$out" | grep -q 'WOULD HAVE MISSED'; } \
    || { [ "$want" = clean ] && ! printf '%s' "$out" | grep -q 'WOULD HAVE MISSED'; }; then
    echo "ok    shadow: $label"
  else
    echo "FAIL  shadow: $label -> $out"
    failures=$((failures + 1))
  fi
}
check_shadow 'a would-skip job failed' missed false false 0 failure
check_shadow 'a would-skip job passed' clean false false 0 success
check_shadow 'a job scoping keeps failed' clean false true 3 failure
check_shadow 'enforced: skipped jobs did not run' clean true false 0 failure
check_shadow 'no scope computed' clean '' '' '' failure

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
