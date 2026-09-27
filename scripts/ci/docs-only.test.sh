#!/usr/bin/env bash
#
# Table-driven test of scripts/ci/docs-only.sh. Each case is a list of
# changed paths (`|` separates files) and the output the classifier must give.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

failures=0
check() {
  local label=$1 paths=$2 expected=$3 actual
  actual=$(printf '%s' "$paths" | tr '|' '\n' | bash ./docs-only.sh)
  if [ "$actual" = "code=$expected" ]; then
    echo "ok    $label -> $actual"
  else
    echo "FAIL  $label: expected code=$expected, got $actual"
    failures=$((failures + 1))
  fi
}

check 'md only' 'CLAUDE.md|apps/web/CLAUDE.md' false
check 'specs yaml' 'specs/phase-3-episodes/server/FILM-305-story-generation.yaml' false
check 'docs/' 'docs/ENGINEERING-WORKFLOW.md|docs/diagram.png' false
check 'README.md' 'README.md' false
check 'specs + docs + md' 'specs/INDEX.md|docs/x.md|packages/ui/README.md' false
check 'pnpm-lock.yaml' 'pnpm-lock.yaml' true
check '.github/x.yml' '.github/x.yml' true
check 'prompt .json' 'packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json' true
check 'mutation guard .json' 'tooling/mutation-guards/kb-80.json' true
check 'this classifier' 'scripts/ci/docs-only.sh' true
check 'mixed md + ts' 'README.md|apps/web/app/page.tsx' true
check 'md-like name' 'apps/web/notes.md.ts' true
check 'specs lookalike' 'apps/web/specs/x.ts|packages/docs-x/y.ts' true
check 'empty' '' true
check 'blank lines only' '||' true

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo 'all cases passed'
