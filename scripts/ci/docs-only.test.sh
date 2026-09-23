#!/usr/bin/env bash
#
# Table test for scripts/ci/docs-only.sh. Each case is a list of changed
# paths (separated by spaces) and the output the classifier must print.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

failures=0
check() {
  local expected=$1 label=$2
  shift 2
  local actual
  actual=$(printf '%s\n' "$@" | bash ./docs-only.sh)
  if [ "$actual" = "code=$expected" ]; then
    echo "ok    $label -> $actual"
  else
    echo "FAIL  $label -> $actual (expected code=$expected)"
    failures=$((failures + 1))
  fi
}

check false 'Markdown only' specs/cross-cutting/FILM-CC-04-known-bugs.md specs/INDEX.md
check false 'spec YAML' specs/phase-3-episodes/server/FILM-305-story-generation.yaml
check false 'spec YML' specs/spikes/example.yml
check false 'README.md' README.md
check false 'docs/' docs/ENGINEERING-WORKFLOW.md docs/diagram.png
check false 'spec Markdown and INDEX' specs/SCHEMA.md specs/INDEX.md
check false 'Markdown in a package' packages/features/episodes/README.md
check true 'pnpm-lock.yaml' pnpm-lock.yaml
check true 'pnpm-workspace.yaml' pnpm-workspace.yaml
check true '.github workflow' .github/workflows/workflow.yml
check true '.github Markdown' .github/pull_request_template.md
check true 'Supabase config' apps/web/supabase/config.toml
check true 'YAML outside specs/' apps/web/some-config.yaml
check true 'prompt JSON' packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json
check true 'package.json' packages/shared/package.json
check true 'locale JSON' apps/web/public/locales/en/common.json
check true 'mutation guard JSON' tooling/mutation-guards/kb-80.json
check true 'the classifier itself' scripts/ci/docs-only.sh
check true 'mixed docs and code' specs/INDEX.md packages/shared/src/utils.ts
check true 'mixed spec and lockfile' specs/phase-3-episodes/server/FILM-305-story-generation.yaml pnpm-lock.yaml
check true 'code only' apps/web/app/page.tsx
check true 'empty diff'

# An empty stdin, not one blank line.
actual=$(bash ./docs-only.sh </dev/null)
if [ "$actual" = "code=true" ]; then
  echo "ok    no input at all -> $actual"
else
  echo "FAIL  no input at all -> $actual (expected code=true)"
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all cases passed"
