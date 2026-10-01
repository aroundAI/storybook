#!/usr/bin/env bash
#
# Table test for scripts/ci/minutes.sh against recorded `gh api` responses
# (fixtures/minutes/). The pull_request runs and their jobs are PR #502's,
# recorded on 2026-10-01 and trimmed to the fields the script reads. The two
# merge-queue runs (ids 1000000001-2) are hand-made, as no queue run existed
# yet: one is PR #502's, the other PR #5021's, which must not be counted.
# Expected figures were computed independently (Python over the same files),
# and run 36881420290's 134 by hand from its 15 jobs.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
FIX=$PWD/fixtures/minutes

stub=$(mktemp -d)
trap 'rm -rf "$stub"' EXIT
cat > "$stub/gh" <<'EOF'
#!/usr/bin/env bash
# Answers the calls minutes.sh makes from the recorded fixture; any other
# call fails, so a new call needs a new fixture.
set -euo pipefail
call="$*"
echo "$call" >> "$FIX_LOG"
case "$call" in
  'pr view 502 --json headRefName -q .headRefName') echo feat/film-1718-stage-diagnosis ;;
  'api --paginate repos/{owner}/{repo}/actions/runs?branch=feat/film-1718-stage-diagnosis&per_page=100') cat "$FIX/runs-branch.json" ;;
  'api --paginate repos/{owner}/{repo}/actions/runs?event=merge_group&per_page=100') cat "$FIX/runs-merge-group.json" ;;
  'api --paginate repos/{owner}/{repo}/actions/runs/'*'/jobs?filter=all&per_page=100')
    id=${call#*actions/runs/}; id=${id%%/*}; cat "$FIX/jobs-$id.json" ;;
  'api repos/{owner}/{repo}/actions/runs/'*)
    cat "$FIX/run-${call##*/}.json" ;;
  *) echo "unexpected gh call: $call" >&2; exit 1 ;;
esac
EOF
chmod +x "$stub/gh"
export GH=$stub/gh FIX FIX_LOG=$stub/calls

failures=0
expect() {
  local label=$1 output=$2 line=$3
  if printf '%s\n' "$output" | grep -qxF -- "$line"; then
    echo "ok    $label"
  else
    echo "FAIL  $label: no line '$line'"
    failures=$((failures + 1))
  fi
}
reject() {
  local label=$1 output=$2 pattern=$3
  if printf '%s\n' "$output" | grep -qF -- "$pattern"; then
    echo "FAIL  $label: found '$pattern'"
    failures=$((failures + 1))
  else
    echo "ok    $label"
  fi
}

pr=$(bash ./minutes.sh 502)
expect 'PR total over every run' "$pr" 'PR #502 (feat/film-1718-stage-diagnosis): 12 run(s), 330 runner-minutes'
expect 'Workflow subtotal' "$pr" 'Workflow: 323 runner-minutes'
expect 'PR records subtotal' "$pr" 'PR records: 7 runner-minutes'
expect 'a full PR run' "$pr" 'run 36881420290  Workflow  pull_request  success  134 min'
expect 'a run cancelled mid-way is still billed' "$pr" 'run 36856604985  Workflow  pull_request  cancelled  22 min'
expect 'a run cancelled before any job is free' "$pr" 'run 36856626414  Workflow  pull_request  cancelled  0 min'
expect '9 seconds rounds up to a minute' "$pr" '     1  🔎 Changes'
expect '37m47s rounds up to 38' "$pr" '    38  ⚫️ Test'
expect 'a skipped job costs nothing' "$pr" '     0  🧬 E2E guards'
expect 'the PR'"'"'s merge-queue run counts' "$pr" 'run 1000000001  Workflow  merge_group  success  32 min'
expect 'a re-run attempt is labelled' "$pr" '    31  ⚫️ Test (attempt 2)'
reject 'another PR'"'"'s queue run (pr-5021) is not counted' "$pr" 'run 1000000002'

run=$(bash ./minutes.sh 36881420290)
expect 'one run by id' "$run" 'run 36881420290: 1 run(s), 134 runner-minutes'
reject 'one run reads nothing else' "$run" 'PR records'

# A read that fails must fail the script, never print a smaller total.
cp -R "$FIX" "$stub/partial"
rm "$stub/partial/jobs-36856745589.json"
if FIX=$stub/partial bash ./minutes.sh 502 >/dev/null 2>&1; then
  echo "FAIL  a failed jobs read must fail the script"
  failures=$((failures + 1))
else
  echo "ok    a failed jobs read fails the script"
fi

if bash ./minutes.sh 2>/dev/null; then
  echo "FAIL  no argument must be a usage error"
  failures=$((failures + 1))
else
  echo "ok    no argument is a usage error"
fi
if bash ./minutes.sh abc 2>/dev/null; then
  echo "FAIL  a non-number must be a usage error"
  failures=$((failures + 1))
else
  echo "ok    a non-number is a usage error"
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
