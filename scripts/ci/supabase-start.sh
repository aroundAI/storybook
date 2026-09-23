#!/usr/bin/env bash
#
# `supabase start` for CI, used by every job that runs a local Supabase.
# Arguments are passed through: supabase-start.sh -x studio,imgproxy
#
# Two defences against ghcr.io refusing image pulls with `toomanyrequests`,
# which failed #336 twice on 2026-09-23 while the same pulls from a
# developer machine succeeded:
#
# 1. Log in to ghcr.io when GHCR_TOKEN is set. Anonymous pulls from GitHub's
#    runners share one limit across every runner; an authenticated pull is
#    counted against this repository's token instead. The login is stored in
#    the runner's Docker config, so later pulls in the same job — pg_prove,
#    pulled by `supabase test db` in the mutation guards — use it too.
# 2. Retry with a backoff measured in minutes. The CLI's own retry waits 4s
#    then 8s; the outage it has to outlast lasted at least five minutes.
#    Images pulled by a failed attempt stay in the Docker cache, so each
#    attempt only fetches what is still missing.
set -uo pipefail

backoff=${SUPABASE_START_BACKOFF:-60 120 240}

if [ -n "${GHCR_TOKEN:-}" ]; then
  if printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-github-actions}" --password-stdin >/dev/null; then
    echo "supabase-start: logged in to ghcr.io"
  else
    echo "supabase-start: ghcr.io login failed; pulling anonymously" >&2
  fi
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
