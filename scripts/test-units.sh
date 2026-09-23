#!/usr/bin/env bash
#
# The unit-test suites that gate a change: CI's Unit Tests job and both deploy
# workflows run this one list, so what blocks a merge and what blocks a deploy
# cannot drift apart. Add a package here, not in a workflow.
#
# --fail-if-no-match on every line: without it pnpm exits 0 when a filter
# matches no package. This list named `@kit/mailers-core`, which does not
# exist, so CI reported that step green for months while the 24 tests in
# `@kit/mailers` never ran.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pnpm --filter web --fail-if-no-match test
pnpm --filter @kit/cache --fail-if-no-match test
pnpm --filter @kit/branding --fail-if-no-match test
pnpm --filter @kit/next --fail-if-no-match test
pnpm --filter @kit/llm --fail-if-no-match test
pnpm --filter @kit/stripe --fail-if-no-match test
pnpm --filter @kit/billing-gateway --fail-if-no-match test
pnpm --filter @kit/lemon-squeezy --fail-if-no-match test
pnpm --filter @kit/prompt-engine --fail-if-no-match test
pnpm --filter @kit/projects --fail-if-no-match test
pnpm --filter @kit/team-accounts --fail-if-no-match test
pnpm --filter @kit/admin --fail-if-no-match test
pnpm --filter @kit/audit-logs --fail-if-no-match test
pnpm --filter @kit/shared --fail-if-no-match test
pnpm --filter @kit/monitoring-core --fail-if-no-match test
pnpm --filter @kit/accounts --fail-if-no-match test
pnpm --filter @kit/auth --fail-if-no-match test
pnpm --filter @kit/i18n --fail-if-no-match test
pnpm --filter @kit/mailers-shared --fail-if-no-match test
pnpm --filter @kit/mailers --fail-if-no-match test
pnpm --filter @kit/otp --fail-if-no-match test
pnpm --filter @kit/supabase --fail-if-no-match test
pnpm --filter @kit/notifications --fail-if-no-match test
pnpm --filter @kit/episodes --fail-if-no-match test
pnpm --filter @kit/audio-generation --fail-if-no-match test
pnpm --filter @kit/ui --fail-if-no-match test
pnpm --filter @kit/database-webhooks --fail-if-no-match test
pnpm --filter @kit/email-templates --fail-if-no-match test
pnpm --filter @kit/analytics --fail-if-no-match test
pnpm --filter @kit/clickhouse --fail-if-no-match test
pnpm --filter @kit/content-analytics --fail-if-no-match test
pnpm --filter @kit/publishing --fail-if-no-match test
