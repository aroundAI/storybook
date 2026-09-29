#!/bin/bash
# db-reset.sh: `supabase db reset`, retried once when the CLI's own setup
# races a service that connects while the database is being recreated. It
# fails with LegacyDbSetupError ("error running container: exit 1") and the
# db logs FATAL: role "postgres" does not exist. Seen twice in ~60 resets on
# 2026-09-29 (#473 lane B, #479 lane A); every stage after it failed too.
# Any other failure, such as a migration that does not apply, fails at once.
# Run from apps/web, as the step it replaces was.
set -u
out=$(mktemp)
trap 'rm -f "$out"' EXIT
for attempt in 1 2; do
  supabase db reset 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}
  [ "$rc" -eq 0 ] && exit 0
  if [ "$attempt" -eq 1 ] && grep -q LegacyDbSetupError "$out"; then
    echo "db reset: LegacyDbSetupError (the CLI's setup raced a connecting service); retrying once"
    sleep 5
    continue
  fi
  exit "$rc"
done
