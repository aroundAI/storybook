# sourced: PR, WT, OUT, ROWFILE must be set
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"; 
export DO_NOT_TRACK=1
export PATH="$WT/apps/web/node_modules/.bin:$PATH"   # CI's pinned Supabase CLI
run() {  # run <job> <step> <command...>; appends a row, never aborts
  local job=$1 step=$2; shift 2
  local slug; slug=$(echo "$job-$step" | tr -c 'A-Za-z0-9' '-' | tr -s '-' | sed 's/^-//' | cut -c1-60)
  local t0; t0=$(date +%s)
  ( cd "$WT" && eval "$@" ) > "$OUT/$slug.log" 2>&1; local rc=$?
  local dt=$(( $(date +%s) - t0 )); local mark="✅"; [ $rc -ne 0 ] && mark="❌"
  echo "$mark|$job|$step|${dt}s|$slug.log" >> "$ROWFILE"
  echo "#$PR $mark $job / $step (${dt}s)"
  return $rc
}
wait_http() { for _ in $(seq 1 90); do curl -sf "$1" >/dev/null && return 0; sleep 2; done; return 1; }
