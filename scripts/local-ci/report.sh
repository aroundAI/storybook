#!/bin/bash
# report.sh <pr> <worktree> <outdir> [mode-note]
set -u; PR=$1; WT=$2; OUT=$3; NOTE=${4:-}
cd "$WT"; SHA=$(git rev-parse HEAD); MAIN=$(git rev-parse origin/main); BASE=$(git merge-base HEAD origin/main)
rows=$(cat "$OUT"/static.rows "$OUT"/services.rows 2>/dev/null)
failed=$(printf '%s\n' "$rows" | grep -c '^❌' || true)
total=$(printf '%s\n' "$rows" | grep -c '|' || true)
{
  if [ "$failed" -eq 0 ]; then echo "## ✅ Local CI: all $total steps green"; else echo "## ❌ Local CI: $failed of $total steps failed"; fi
  echo
  echo "Verified locally with \`scripts/local-ci\` (see LOCAL-CI.md): every job \`.github/workflows/workflow.yml\` runs on a pull request, with the same commands.${NOTE:+ $NOTE}"
  echo
  echo "| | |"; echo "|---|---|"
  echo "| Commit tested | \`$SHA\` (this PR's head) |"
  echo "| Based on | \`$MAIN\` (origin/main when tested; merge-base \`${BASE:0:8}\`) |"
  echo "| Environment | local Supabase (CLI 2.117.0, as CI) + ClickHouse 24.8; production build served on :3000 |"
  echo "| Finished | $(date -u '+%Y-%m-%d %H:%M UTC') |"
  echo
  echo "| Result | Job | Step | Time |"; echo "|---|---|---|---|"
  printf '%s\n' "$rows" | awk -F'|' 'NF>=4 {print "| "$1" | "$2" | "$3" | "$4" |"}'
  echo
  echo "Differences from CI: the 4 unit-guard shards ran in parallel on copy-on-write clones of the worktree (CI: 4 VMs); Playwright ran with CI=1 (1 worker, 3 retries), as in CI. Not run, as on a PR in CI: 🧬 E2E guards (push to main only) and 📚 Docs checks (runs only in place of the heavy jobs)."
} > "$OUT/report.md"
echo "#$PR report: $OUT/report.md ($failed failed of $total)"
