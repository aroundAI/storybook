---
spec_id: FILM-1509
title: Analytics Experiment Log
status: 🟡 PARTIAL
audited: 2026-09-23
effort: M
dependencies: FILM-1502
---

# Analytics Experiment Log

## 1. Overview

The playbook: "Keep a manual log alongside the analytics: what you tried, what you expected, what happened. Studio tells you what the numbers did but not what you changed." This spec adds a structured experiment log with **auto-captured metric snapshots** at start and conclusion, linked to publishes and taxonomy tags. Data model follows the `social_posts` pattern (`40-social-posts.sql`).

## 2. Database Schema — `apps/web/supabase/schemas/69-analytics-experiments.sql`

```sql
create table if not exists public.analytics_experiments (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title varchar(200) not null,
  hypothesis text,
  change_description text not null,
  expected_outcome text,
  actual_outcome text,
  outcome_status varchar(20) not null default 'pending',
  status varchar(20) not null default 'planned',
  started_at date,
  ended_at date,
  baseline_metrics jsonb not null default '{}'::jsonb,
  result_metrics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outcome_status in ('pending', 'confirmed', 'rejected', 'inconclusive')),
  check (status in ('planned', 'running', 'concluded', 'abandoned'))
);

create table if not exists public.experiment_publishes (
  experiment_id uuid not null references public.analytics_experiments(id) on delete cascade,
  publish_id uuid not null references public.publishes(id) on delete cascade,
  primary key (experiment_id, publish_id)
);

create table if not exists public.experiment_tags (
  experiment_id uuid not null references public.analytics_experiments(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  primary key (experiment_id, tag_id)
);
-- RLS: has_role_on_account(account_id) on experiments; join tables via parent experiment
```

## 3. Implementation Map

| File | Purpose |
|------|---------|
| `packages/features/content-analytics/src/server/experiment-actions.ts` | `createExperimentAction`, `updateExperimentAction`, `listExperimentsAction`, `getExperimentAction`; `startExperimentAction` snapshots `queryTotalsByVideoIds` for linked publishes into `baseline_metrics`; `concludeExperimentAction` snapshots into `result_metrics` and requires `actual_outcome`. Pattern: `packages/features/publishing/src/server/social-post-actions.ts`. |
| `components/experiments/experiment-list.tsx` | List with status/outcome badges. |
| `components/experiments/experiment-form.tsx` | react-hook-form + `@kit/ui/form`, shared Zod schema. |
| `components/experiments/experiment-detail.tsx` | Hypothesis vs outcome, baseline-vs-result metric deltas, linked publishes. |
| `apps/web/app/home/[account]/studio/analytics/experiments/page.tsx` | Route. Nav entry in `config/team-account-navigation.config.tsx`. |

## 4. Acceptance Criteria

- [ ] Full lifecycle works: create → link publishes/tags → start (baseline captured) → conclude (results captured, actual_outcome required) — *audit: not met* — tags cannot be linked (form always sends `tagIds: []`, `experiment-form.tsx:101`); the rest passes `apps/e2e/tests/experiments/experiments.spec.ts:224`
- [x] Metric deltas render on the detail view — *audit:* baseline and result of the watched metric (FILM-1610): `apps/e2e/tests/experiments/experiments-evidence.spec.ts:198`, `:237`
- [ ] RLS: second account's user cannot read or modify — *audit: unverified* — policies at `apps/web/supabase/migrations/20260827103738_analytics-experiments.sql:81`; pgTAP covers only an outsider linking (`experiment-publishes-account-rls.test.sql:89`)
- [ ] Experiments appear newest-first with filter by status — *audit: not met* — newest-first holds (`experiment-actions.ts:736`); the page has no status filter and never passes `status`

## 5. Verification

```bash
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test
```

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Link tags to an experiment | The server accepts `tagIds` (`packages/features/content-analytics/src/server/experiment-actions.ts:324`), but the form always sends `tagIds: []` (`packages/features/content-analytics/src/components/experiments/experiment-form.tsx:101`) and `TagPicker` has never had a caller. The same missing tag UI leaves FILM-1507 open | unassigned |
| Filter experiments by status | `listExperimentsAction` accepts `status` (`experiment-actions.ts:733`), but the page calls it with `{ accountId }` only (`apps/web/app/home/[account]/studio/analytics/experiments/_components/experiments-client.tsx:79`) and renders no filter. It never had one. FILM-1610's "Due for review" list is a different question | unassigned |
