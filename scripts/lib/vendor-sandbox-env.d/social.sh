#!/usr/bin/env bash
# FILM-1802: the social platforms' lines in local.env's vendor-sandbox block.
# Run by ensure_sandbox_env (scripts/lib/vendor-sandbox.sh) inside the block;
# its stdout lands there. The values come from apps/vendor-sandbox's own
# constants (src/social/env-lines.ts), so ports and client ids have one source.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT/apps/vendor-sandbox"
exec ./node_modules/.bin/tsx src/social/env-lines.ts
