#!/usr/bin/env bash
#
# `supabase start` for CI, used by every job that runs a local Supabase.
# Arguments are passed through: supabase-start.sh -x studio,imgproxy
#
# Two defences against image pulls refused with `toomanyrequests`, which
# failed #336's CI on 2026-09-23 from 17:47 UTC onwards:
#
# 1. Clear SUPABASE_INTERNAL_IMAGE_REGISTRY. `supabase/setup-cli` exports it
#    as `ghcr.io`, which pins every pull to ghcr.io alone. Unset, CLI 2.117.0
#    tries public.ecr.aws, then ghcr.io, then Docker Hub — the order a
#    developer machine uses. ghcr.io refused runner pulls whether logged in
#    or not and whether pulled in parallel or one at a time, while
#    public.ecr.aws served all nine images (diagnostic run 35903103102). An
#    empty value counts as unset to the CLI, and it is written to GITHUB_ENV
#    so later steps (pg_prove in the database guards, `supabase stop`) pull
#    from the same place.
# 2. Retry with a backoff measured in minutes. The CLI's own retry waits 4s
#    then 8s, which cannot outlast an outage of minutes. Images pulled by a
#    failed attempt stay in the Docker cache, so each attempt only fetches
#    what is still missing.
set -uo pipefail

backoff=${SUPABASE_START_BACKOFF:-60 120 240}

export SUPABASE_INTERNAL_IMAGE_REGISTRY=
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "SUPABASE_INTERNAL_IMAGE_REGISTRY=" >> "$GITHUB_ENV"
fi

attempt=1
for wait in $backoff ''; do
  if supabase start "$@"; then
    exit 0
  fi
  if [ -z "$wait" ]; then
    echo "supabase-start: 'supabase start' failed on attempt $attempt; giving up" >&2
    exit 1
  fi
  echo "supabase-start: attempt $attempt failed; stopping and retrying in ${wait}s" >&2
  supabase stop --no-backup >/dev/null 2>&1 || true
  sleep "$wait"
  attempt=$((attempt + 1))
done
