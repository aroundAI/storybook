# Sourced by every local-ci script. Sets:
#   CI        this directory (the scripts)
#   MAINROOT  the main checkout (worktrees share it; state lives beside it)
#   STATE     working state: runs/, lockq/, db.lock, next-cache-seed, train.log
CI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MAINROOT=$(cd "$(git -C "$CI" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
STATE=${LOCAL_CI_DIR:-$MAINROOT/.local-ci}
mkdir -p "$STATE/runs" "$STATE/lockq"
