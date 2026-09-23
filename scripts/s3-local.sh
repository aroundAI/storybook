#!/usr/bin/env bash
#
# A local S3-compatible server (MinIO) for tests that need a real SigV4
# implementation: apps/web/app/api/storage/presign/__tests__/
# s3-presign.s3-local.test.ts proves an upload URL refuses a PUT whose type or
# size differs from what it was signed for (KB-38). Nothing here talks to R2.
#
#   ./scripts/s3-local.sh up      # start on 127.0.0.1:19138, create the bucket
#   ./scripts/s3-local.sh env     # print the variables the test reads
#   ./scripts/s3-local.sh down
#
# The credentials are throwaway values for this container only.
set -euo pipefail

NAME=storybook-s3-local
IMAGE=quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
PORT=19138
USER_KEY=s3local
USER_SECRET=s3localsecret
BUCKET=s3-local-test

print_env() {
  cat <<EOF
S3_LOCAL_ENDPOINT=http://127.0.0.1:${PORT}
S3_LOCAL_ACCESS_KEY=${USER_KEY}
S3_LOCAL_SECRET_KEY=${USER_SECRET}
S3_LOCAL_BUCKET=${BUCKET}
EOF
}

case "${1:-}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:9000" \
      -e MINIO_ROOT_USER="$USER_KEY" -e MINIO_ROOT_PASSWORD="$USER_SECRET" \
      "$IMAGE" server /data >/dev/null

    until docker exec "$NAME" mc alias set local http://127.0.0.1:9000 \
      "$USER_KEY" "$USER_SECRET" >/dev/null 2>&1; do sleep 1; done

    docker exec "$NAME" mc mb --ignore-existing "local/${BUCKET}" >/dev/null
    # Anonymous reads, so a test can see what was stored the way a browser would.
    docker exec "$NAME" mc anonymous set download "local/${BUCKET}" >/dev/null
    print_env
    ;;
  env)
    print_env
    ;;
  down)
    docker rm -f "$NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 up|env|down" >&2
    exit 2
    ;;
esac
