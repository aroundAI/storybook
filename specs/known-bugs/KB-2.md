---
id: KB-2
title: "`scripts/deploy.sh` deploys even when migrations fail"
status: fixed
fixed_in: ["#349"]
fixed_summary: "`deploy.sh` deployed when migrations failed; `db diff` could still read the partial `schemas/`; docs and the MCP tool named old local ports; `STORAGE_PROVIDER=s3` (templates and the SST default) silently meant Supabase; 203 spec citations pointed at moved or changed code"
severity: Low
found: 2026-09-19
---

## KB-2 — `scripts/deploy.sh` deploys even when migrations fail

> **Fixed (2026-09-24), #349.** It failed open at five points, not three: also
> with no `SUPABASE_PROJECT_REF` (it skipped migrations and deployed), and when
> a ClickHouse migration failed ("continuing deployment without ClickHouse").
> Each now stops before the build with `❌ … — not deploying`;
> `DEPLOY_SKIP_MIGRATIONS=1` skips migrations deliberately and says so.
> Reproduced by running the script: `packages/shared/__tests__/deploy-fail-closed.test.ts`
> runs it under bash with stubbed `aws`/`pnpm`/`supabase`/`npx` and an empty
> environment; on `main` all five cases exited 0 and called
> `pnpm sst deploy`. Mutation guards `tooling/mutation-guards/kb-2.json`.

**Severity:** Low — deploys work today (`pnpm deploy:production`), and the
risk is only on a failed migration. **Found:** FILM-1610 review, round 3.

Step 5 applies migrations before the build, which is the right order, but
it **fails open** at three points (`scripts/deploy.sh`, from the
"Apply Supabase Migrations" section):

- the `supabase` CLI is not installed → prints "Skipping migrations" and
  continues;
- `supabase link` fails → prints debug info and continues;
- `supabase db push` fails → prints "You may need to apply migrations
  manually" and continues.

In each case the app is built and deployed against the old schema. For a
change like FILM-1610, whose code reads columns only its migrations
create, that means every read touching them fails in production.

**Proposed fix:** exit non-zero at each of the three points, as the GitHub
deploy workflows now do (#264).
