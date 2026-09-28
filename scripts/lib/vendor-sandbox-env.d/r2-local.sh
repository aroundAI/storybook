#!/usr/bin/env bash
# FILM-1806: R2 for the workers, in local.env's vendor-sandbox block. A laptop
# has no R2, so the voice and audio workers point their S3 client at local
# Supabase Storage's S3 endpoint (read only under FILM-1801's gate). The keys
# are the local stack's own, printed by `supabase status`; no production value
# is used. Prints nothing when local Supabase is not running.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
status=$(cd "$ROOT/apps/web" && supabase status -o env 2> /dev/null || true)
value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" | head -n 1; }
api=$(value API_URL)
s3=$(value STORAGE_S3_URL)
id=$(value S3_PROTOCOL_ACCESS_KEY_ID)
secret=$(value S3_PROTOCOL_ACCESS_KEY_SECRET)
region=$(value S3_PROTOCOL_REGION)
[ -n "$api" ] && [ -n "$s3" ] && [ -n "$id" ] && [ -n "$secret" ] || exit 0
cat << LINES
# R2 for the workers (FILM-1806): local Supabase Storage's S3 endpoint and the
# public bucket local-env.sh creates. The bucket holds each logical bucket as a
# key prefix, as production's one R2 bucket does.
VENDOR_URL_R2=$s3
R2_ACCESS_KEY_ID=$id
R2_SECRET_ACCESS_KEY=$secret
R2_REGION=${region:-local}
R2_BUCKET_NAME=r2-local
R2_PUBLIC_URL=$api/storage/v1/object/public/r2-local
LINES
