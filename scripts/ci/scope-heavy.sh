#!/usr/bin/env bash
#
# Which heavy jobs a merge-queue run needs (Phase 2 of the merge-queue
# design). Prints `key=value` lines, ready to append to $GITHUB_OUTPUT.
#
#   scope-heavy.sh <base> [<head>]   the change from base...head (head: HEAD)
#   scope-heavy.sh --classify        the same rule, from changed paths on
#                                    stdin and SCOPE_* in the environment
#   scope-heavy.sh --summary         key=value on stdin -> job summary Markdown
#   scope-heavy.sh --shadow          toJSON(needs) on stdin -> report-only's
#                                    "would have missed" check, as Markdown
#
# The rule:
#   ⚫️ Test, 🧬 E2E evidence  web or web-e2e is in turbo's affected set
#                             (`turbo ls --affected`: the dependency graph,
#                             so any of web's @kit/* packages counts)
#   🏗️ Next build             web is in turbo's affected set (`turbo ls
#                             --affected`), as for ⚫️ Test, but not web-e2e:
#                             a spec cannot break `next build`
#   🐘 Supabase DB            SQL, the Supabase package, the generated types,
#                             a file one of its steps reads, or a changed
#                             pgTAP guard
#   🧪 Unit / 🧬 E2E guards    only the entries `run.py --changed` selects;
#                             the job is skipped when that is none
#   everything                any root file but Markdown (package.json, the
#                             lockfile, turbo.json, tsconfig*, dotfiles),
#                             .github/**, tooling/** except the guard JSON,
#                             scripts/ci/**; and an empty diff, a failed
#                             turbo, or any count this script cannot read
#
# Verdict keys: full, reason, test, build, supabase, unit_guards, e2e_guards.
# Effective keys, which the jobs gate on: enforced, skip_test, skip_build,
# skip_supabase, skip_unit_guards, skip_e2e_guards, unit_shards, e2e_shards. A job is
# skipped only when SCOPE_ENFORCE (vars.CI_SCOPE_HEAVY) is exactly `true` and
# the verdict is not `full`; otherwise every skip_* is false and the shards
# are the full set: report-only. Table test: scripts/ci/scope-heavy.test.sh.
set -euo pipefail

UNIT_SHARDS=6 # 🧪 Unit guards' matrix in .github/workflows/workflow.yml
E2E_SHARDS=5  # 🧬 E2E guards' matrix

shards() { # shards <count> <cap>: "[1,2,...]", at least [1]
  local n=$1 cap=$2 i out=1
  [ "$n" -gt "$cap" ] && n=$cap
  for ((i = 2; i <= n; i++)); do out+=",$i"; done
  echo "[$out]"
}

is_count() { [[ $1 =~ ^[0-9]+$ ]]; }

emit() { # emit <full> <reason> <test> <supabase> <unit> <e2e> <build>
  local full=$1 reason=$2 test=$3 supabase=$4 unit=$5 e2e=$6 build=$7
  local enforced=false
  if [ "${SCOPE_ENFORCE:-}" = true ] && [ "$full" = false ]; then
    enforced=true
  fi
  echo "full=$full"
  echo "reason=$reason"
  echo "test=$test"
  echo "build=$build"
  echo "supabase=$supabase"
  echo "unit_guards=$unit"
  echo "e2e_guards=$e2e"
  echo "enforced=$enforced"
  if [ "$enforced" = true ]; then
    echo "skip_test=$([ "$test" = true ] && echo false || echo true)"
    echo "skip_build=$([ "$build" = true ] && echo false || echo true)"
    echo "skip_supabase=$([ "$supabase" = true ] && echo false || echo true)"
    echo "skip_unit_guards=$([ "$unit" -gt 0 ] && echo false || echo true)"
    echo "skip_e2e_guards=$([ "$e2e" -gt 0 ] && echo false || echo true)"
    echo "unit_shards=$(shards "$unit" "$UNIT_SHARDS")"
    echo "e2e_shards=$(shards "$e2e" "$E2E_SHARDS")"
  else
    echo "skip_test=false"
    echo "skip_build=false"
    echo "skip_supabase=false"
    echo "skip_unit_guards=false"
    echo "skip_e2e_guards=false"
    echo "unit_shards=$(shards "$UNIT_SHARDS" "$UNIT_SHARDS")"
    echo "e2e_shards=$(shards "$E2E_SHARDS" "$E2E_SHARDS")"
  fi
}

everything() { emit true "$1" true true all all true; }

classify() {
  local path count=0 root=() supabase=false test=false build=false
  while IFS= read -r path || [ -n "$path" ]; do
    [ -z "$path" ] && continue
    count=$((count + 1))
    case "$path" in
      .github/*) root+=("$path") ;;
      tooling/mutation-guards/*.json) ;;
      *.md) ;;
      tooling/* | scripts/ci/*) root+=("$path") ;;
      */*) ;;
      *) root+=("$path") ;;
    esac
    case "$path" in
      apps/web/supabase/* | packages/supabase/* | apps/web/lib/database.types.ts \
        | apps/web/scripts/check-schema-drift.ts | apps/web/scripts/check-types-current.ts \
        | packages/features/episodes/src/lib/canon/* \
        | packages/features/episodes/scripts/verify-memory-context.ts \
        | apps/e2e/tests/utils/seed.ts)
        supabase=true ;;
    esac
  done

  if [ "$count" -eq 0 ]; then
    everything 'empty diff'
    return
  fi
  if [ "${#root[@]}" -ne 0 ]; then
    everything "root config: ${root[*]:0:3}$([ "${#root[@]}" -gt 3 ] && echo " (+$((${#root[@]} - 3)))")"
    return
  fi
  local affected=${SCOPE_AFFECTED-?}
  if [ "$affected" = '?' ]; then
    everything 'turbo affected set unavailable'
    return
  fi
  local unit=${SCOPE_UNIT_GUARDS:-} e2e=${SCOPE_E2E_GUARDS:-} pgtap=${SCOPE_PGTAP_GUARDS:-}
  if ! is_count "$unit" || ! is_count "$e2e" || ! is_count "$pgtap"; then
    everything "changed-guard count unreadable (unit='$unit' e2e='$e2e' pgtap='$pgtap')"
    return
  fi
  # Names, one per line (turbo's JSON gives lines; spaces are accepted too).
  affected=$(printf '%s\n' "$affected" | tr ' ' '\n' | grep . || true)
  if printf '%s\n' "$affected" | grep -qxE 'web|web-e2e'; then test=true; fi
  if printf '%s\n' "$affected" | grep -qx 'web'; then build=true; fi
  if [ "$pgtap" -gt 0 ]; then supabase=true; fi
  local n
  n=$(printf '%s\n' "$affected" | grep -c . || true)
  emit false "$count file(s); $n package(s) affected" "$test" "$supabase" "$unit" "$e2e" "$build"
}

from_git() {
  local base=$1 head=${2:-HEAD} here root
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  root=$(cd "$here/../.." && pwd)
  cd "$root"
  if [ -z "$base" ] || [ -z "${base//0/}" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null \
    || ! git cat-file -e "$head^{commit}" 2>/dev/null; then
    everything "no usable base ('$base') or head ('$head')"
    return
  fi
  local files
  if ! files=$(git diff --name-only --no-renames "$base...$head"); then
    everything 'git diff failed'
    return
  fi
  # TURBO: the turbo command, for a machine that has it installed; CI has no
  # install in 🔎 Changes and fetches the repo's pinned version.
  local turbo json
  turbo=${TURBO:-npx --yes turbo@$(jq -r '.devDependencies.turbo' package.json)}
  if json=$(TURBO_SCM_BASE=$base TURBO_SCM_HEAD=$head $turbo ls --affected --output=json 2>/dev/null) \
    && SCOPE_AFFECTED=$(printf '%s' "$json" | jq -r '.packages.items[].name'); then
    export SCOPE_AFFECTED
  else
    export SCOPE_AFFECTED='?'
  fi
  local kind var list
  for kind in unit e2e pgtap; do
    var=SCOPE_$(echo "$kind" | tr '[:lower:]' '[:upper:]')_GUARDS
    if list=$(python3 tooling/mutation-guards/run.py --kind "$kind" --changed "$base...$head" --list); then
      export "$var=$(printf '%s' "$list" | grep -c . || true)"
    else
      export "$var=?"
    fi
  done
  printf '%s\n' "$files" | classify
}

summary() {
  local key value enforced='' reason='?' test=true build=true supabase=true unit=all e2e=all
  while IFS='=' read -r key value; do
    case "$key" in
      enforced) enforced=$value ;;
      reason) reason=$value ;;
      test) test=$value ;;
      build) build=$value ;;
      supabase) supabase=$value ;;
      unit_guards) unit=$value ;;
      e2e_guards) e2e=$value ;;
    esac
  done
  local mode='report-only: this run still runs everything'
  [ "$enforced" = true ] && mode='enforced: skipped jobs did not run'
  verdict() { # verdict <runs?> -> cell
    if [ "$1" = true ]; then echo 'runs'
    elif [ "$enforced" = true ]; then echo '**skipped**'
    else echo '**would skip**'; fi
  }
  guards() { # guards <count|all>
    if [ "$1" = all ]; then echo 'all'
    elif [ "$1" = 0 ]; then verdict false
    else echo "$1 changed"; fi
  }
  echo "### Heavy-job scope ($mode)"
  echo
  echo "Reason: $reason. Switch: \`vars.CI_SCOPE_HEAVY\` (\`true\` enforces)."
  echo
  echo '| Job | Scope |'
  echo '|---|---|'
  echo "| ⚫️ Test, 🧬 E2E evidence | $(verdict "$test") |"
  echo "| 🏗️ Next build | $(verdict "$build") |"
  echo "| 🐘 Supabase DB | $(verdict "$supabase") |"
  echo "| 🧪 Unit guards | $(guards "$unit") |"
  echo "| 🧬 E2E guards | $(guards "$e2e") |"
}

shadow() {
  local needs out
  needs=$(cat)
  out=$(printf '%s' "$needs" | jq -r '
    .changes.outputs as $o
    | if ($o.scope_enforced // "") != "false" or ($o.scope_full // "") != "false" then empty
      else
        [ (if $o.scope_test == "false" then "test", "e2e-evidence" else empty end),
          (if $o.scope_build == "false" then "next-build" else empty end),
          (if $o.scope_supabase == "false" then "supabase-db" else empty end),
          (if $o.scope_unit_guards == "0" then "unit-guards" else empty end),
          (if $o.scope_e2e_guards == "0" then "e2e-guards" else empty end) ][]
        | select(($needs[.].result // "") == "failure")
      end' --argjson needs "$needs")
  [ -n "$(printf '%s' "$needs" | jq -r '.changes.outputs.scope_enforced // ""')" ] || return 0
  echo '### Heavy-job scope: shadow check'
  if [ -z "$out" ]; then
    echo 'No job that scoping would have skipped failed.'
  else
    echo "**WOULD HAVE MISSED:** $(printf '%s' "$out" | tr '\n' ' ')— scoping would have skipped a job that failed."
    echo "Record this run before setting \`CI_SCOPE_HEAVY=true\`."
  fi
}

case "${1:-}" in
  --classify) classify ;;
  --summary) summary ;;
  --shadow) shadow ;;
  -*) echo "usage: $0 <base> [<head>] | --classify | --summary | --shadow" >&2; exit 2 ;;
  *) from_git "${1:-}" "${2:-}" ;;
esac
