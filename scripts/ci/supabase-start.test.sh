#!/usr/bin/env bash
#
# Test for scripts/ci/supabase-start.sh against a fake `supabase` command
# that records its calls, and the registry it saw, and fails a set number of
# times. Every case starts with the registry pinned to ghcr.io, as
# `supabase/setup-cli` leaves it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/supabase" <<'EOF'
#!/usr/bin/env bash
echo "supabase $* registry=${SUPABASE_INTERNAL_IMAGE_REGISTRY-unset}" >> "$FAKE_LOG"
if [ "$1" = start ]; then
  n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0)
  echo $((n + 1)) > "$FAKE_COUNT"
  [ "$n" -ge "$FAKE_FAILS" ]
fi
EOF
cat > "$tmp/sleep" <<'EOF'
#!/usr/bin/env bash
echo "sleep $*" >> "$FAKE_LOG"
EOF
chmod +x "$tmp/supabase" "$tmp/sleep"

failures=0
run_case() {
  local label=$1 fails=$2 expected_status=$3 expected_log=$4
  rm -f "$tmp/log" "$tmp/count" "$tmp/github_env"
  local status=0
  PATH="$tmp:$PATH" FAKE_LOG="$tmp/log" FAKE_COUNT="$tmp/count" FAKE_FAILS=$fails \
    SUPABASE_START_BACKOFF='1 2' SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io \
    GITHUB_ENV="$tmp/github_env" \
    bash "$here/supabase-start.sh" -x studio >/dev/null 2>&1 || status=$?
  local log
  log=$(tr '\n' ';' < "$tmp/log")
  local env_file
  env_file=$(cat "$tmp/github_env" 2>/dev/null || true)
  if [ "$status" = "$expected_status" ] && [ "$log" = "$expected_log" ] &&
    [ "$env_file" = 'SUPABASE_INTERNAL_IMAGE_REGISTRY=' ]; then
    echo "ok    $label"
  else
    echo "FAIL  $label: status=$status log=$log github_env=$env_file"
    echo "      expected status=$expected_status log=$expected_log github_env=SUPABASE_INTERNAL_IMAGE_REGISTRY="
    failures=$((failures + 1))
  fi
}

run_case 'first try succeeds, registry cleared' 0 0 \
  'supabase start -x studio registry=;'
run_case 'two failures, third attempt succeeds' 2 0 \
  'supabase start -x studio registry=;supabase stop --no-backup registry=;sleep 1;supabase start -x studio registry=;supabase stop --no-backup registry=;sleep 2;supabase start -x studio registry=;'
run_case 'every attempt fails: exit 1, no sleep after the last' 9 1 \
  'supabase start -x studio registry=;supabase stop --no-backup registry=;sleep 1;supabase start -x studio registry=;supabase stop --no-backup registry=;sleep 2;supabase start -x studio registry=;'

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
