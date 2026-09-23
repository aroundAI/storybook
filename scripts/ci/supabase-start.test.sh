#!/usr/bin/env bash
#
# Test for scripts/ci/supabase-start.sh against fake `supabase` and `docker`
# commands that record their calls and fail a set number of times.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/supabase" <<'EOF'
#!/usr/bin/env bash
echo "supabase $*" >> "$FAKE_LOG"
if [ "$1" = start ]; then
  n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0)
  echo $((n + 1)) > "$FAKE_COUNT"
  [ "$n" -ge "$FAKE_FAILS" ]
fi
EOF
cat > "$tmp/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $* password=$(cat)" >> "$FAKE_LOG"
EOF
cat > "$tmp/sleep" <<'EOF'
#!/usr/bin/env bash
echo "sleep $*" >> "$FAKE_LOG"
EOF
chmod +x "$tmp/supabase" "$tmp/docker" "$tmp/sleep"

failures=0
run_case() {
  local label=$1 fails=$2 expected_status=$3 expected_log=$4 token=${5:-}
  rm -f "$tmp/log" "$tmp/count"
  local status=0
  PATH="$tmp:$PATH" FAKE_LOG="$tmp/log" FAKE_COUNT="$tmp/count" FAKE_FAILS=$fails \
    SUPABASE_START_BACKOFF='1 2' GHCR_TOKEN="$token" \
    bash "$here/supabase-start.sh" -x studio >/dev/null 2>&1 || status=$?
  local log
  log=$(tr '\n' ';' < "$tmp/log")
  if [ "$status" = "$expected_status" ] && [ "$log" = "$expected_log" ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label: status=$status log=$log"
    echo "      expected status=$expected_status log=$expected_log"
    failures=$((failures + 1))
  fi
}

run_case 'first try succeeds, no token' 0 0 \
  'supabase start -x studio;'
run_case 'token logs in before starting' 0 0 \
  'docker login ghcr.io -u github-actions --password-stdin password=tok;supabase start -x studio;' tok
run_case 'two failures, third attempt succeeds' 2 0 \
  'supabase start -x studio;supabase stop --no-backup;sleep 1;supabase start -x studio;supabase stop --no-backup;sleep 2;supabase start -x studio;'
run_case 'every attempt fails: exit 1, no sleep after the last' 9 1 \
  'supabase start -x studio;supabase stop --no-backup;sleep 1;supabase start -x studio;supabase stop --no-backup;sleep 2;supabase start -x studio;'

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
