#!/bin/bash
# unpin-linked-versions.sh: make `supabase start` use the CLI's own image
# versions, which is what CI runs.
#
# `supabase link` (the db:link:prod script) writes the linked project's
# service versions and storage migration target to apps/web/supabase/.temp/*-version, and every later
# `supabase start` pulls those instead of the CLI's defaults. Linked to
# production on 2026-10-03, a local stack ran storage-api v1.77.5, postgres
# 17.6.1.063 and postgrest v14.5 while CI's (no link, .temp is gitignored)
# ran v1.72.1, 17.6.1.167 and v16.2. Run it before `supabase start`.
set -eu
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/apps/web/supabase/.temp"
for f in storage-version postgres-version rest-version gotrue-version storage-migration; do
  if [ -f "$dir/$f" ]; then
    echo "unpin: removing $dir/$f ($(cat "$dir/$f")), the linked project's pin"
    rm -f "$dir/$f"
  fi
done
