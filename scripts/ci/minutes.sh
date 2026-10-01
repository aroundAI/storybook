#!/usr/bin/env bash
#
# Runner-minutes spent on a pull request, or on one run, read from the
# GitHub API (FR10 of the merge-queue design, 2026-10-01), so a saving is
# measured rather than asserted.
#
#   scripts/ci/minutes.sh 505            # PR #505: every run, every workflow
#   scripts/ci/minutes.sh 36881420290    # one run
#
# A number below 1,000,000 is a PR number; anything larger is a run id.
#
# A job's minutes are completed_at - started_at, rounded up to a whole
# minute, as GitHub bills them. A job that never started, or was skipped,
# costs 0. Every attempt of a re-run job counts (`filter=all`), and so does
# a cancelled run: it was billed.
#
# A PR's runs are those on its head branch (pull_request and
# workflow_dispatch events: the API returns no PR number on a merged PR's
# runs, so the branch is the key) plus its merge-queue runs, whose branch is
# gh-readonly-queue/<base>/pr-<n>-<sha>.
#
# GH overrides the gh binary; the table test (minutes.test.sh) points it at
# recorded responses.
set -euo pipefail

GH=${GH:-gh}

if [ $# -ne 1 ] || ! [[ $1 =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <pr-number|run-id>" >&2
  exit 2
fi
arg=$1

api() { "$GH" api --paginate "repos/{owner}/{repo}/$1"; }

# One run as a TSV block: a header line, then one line per job.
report_run() {
  local id=$1 name=$2 event=$3 conclusion=$4
  local jobs
  # Explicit: errexit does not reach inside $(…), and a failed read must
  # stop the script rather than print a total that left this run out.
  jobs=$(api "actions/runs/$id/jobs?filter=all&per_page=100" | jq -s '[.[].jobs[]]') || return 1
  printf '%s' "$jobs" | jq -r --arg id "$id" --arg name "$name" --arg event "$event" --arg c "$conclusion" '
    def minutes:
      if .started_at == null or .completed_at == null then 0
      else ((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601))
        | if . <= 0 then 0 else (. / 60 | ceil) end
      end;
    (map(minutes) | add // 0) as $total
    | "run \($id)  \($name)  \($event)  \($c)  \($total) min",
      (.[] | "  \(minutes | tostring | (" " * (4 - length)) + .)  \(.name)\(if .run_attempt > 1 then " (attempt \(.run_attempt))" else "" end)"),
      "@total \($name)\t\($total)"'
}

if [ "$arg" -ge 1000000 ]; then
  runs=$("$GH" api "repos/{owner}/{repo}/actions/runs/$arg" | jq -c '[.]')
  label="run $arg"
else
  head=$("$GH" pr view "$arg" --json headRefName -q .headRefName)
  branch_runs=$(api "actions/runs?branch=$head&per_page=100" \
    | jq -s '[.[].workflow_runs[] | select(.event == "pull_request" or .event == "workflow_dispatch")]')
  queue_runs=$(api "actions/runs?event=merge_group&per_page=100" \
    | jq -s --arg n "$arg" '[.[].workflow_runs[] | select(.head_branch | test("^gh-readonly-queue/[^ ]+/pr-" + $n + "-"))]')
  runs=$(jq -cn --argjson a "$branch_runs" --argjson b "$queue_runs" '$a + $b | sort_by(.id)')
  label="PR #$arg ($head)"
fi

out=""
while IFS=$'\t' read -r id name event conclusion; do
  block=$(report_run "$id" "$name" "$event" "$conclusion") || exit 1
  out+=$block$'\n'
done < <(printf '%s' "$runs" | jq -r '.[] | [.id, .name, .event, (.conclusion // "in_progress")] | @tsv')

printf '%s' "$out" | grep -v '^@total ' || true
count=$(printf '%s' "$runs" | jq 'length')
totals=$(printf '%s' "$out" | grep '^@total ' | sed 's/^@total //' || true)
printf '%s\n' "$totals" | awk -F'\t' 'NF == 2 { by[$1] += $2 } END { for (w in by) printf "%s: %d runner-minutes\n", w, by[w] }' | LC_ALL=C sort
printf '%s\n' "$totals" | awk -F'\t' -v label="$label" -v count="$count" \
  'NF == 2 { total += $2 } END { printf "%s: %d run(s), %d runner-minutes\n", label, count, total }'
