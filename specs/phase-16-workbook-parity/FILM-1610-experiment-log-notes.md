---
spec_id: FILM-1610
title: Experiment Log & Per-Video Notes
status: DRAFT
effort: M
dependencies: FILM-1602, FILM-1603, FILM-1605
---

# Experiment Log & Per-Video Notes

## 1. Overview

FILM-1509 shipped an experiment log that records *what was changed* and
*what happened overall*. The workbook's Experiment Log asks two further
questions it cannot answer.

**"Which metric was this experiment about?"** `captureSnapshot`
(`experiment-actions.ts:47-77`) records the same six totals for every
experiment — views, likes, comments, shares, watch time, revenue — summed
across the linked publishes over **all time**
(`queryTotalsByVideoIds(publishIds)` with no date window). A thumbnail test
and a hook-length test produce identical-shaped evidence, and neither
records the number the experimenter was actually watching. A CTR experiment
is judged on lifetime view totals.

**"Is this one due for review?"** `analytics_experiments` has `started_at`
and `ended_at` and nothing in between. There is no review window, so
nothing can list what is ripe, and an experiment concluded on day 74 is
reported as though it were the 60-day result it was designed to be.

Two smaller gaps travel with these. Experiments have no `connection_id`, so
a test run on one channel cannot be told from one run on another — a
channel dimension FILM-1602 added everywhere else. And there is nowhere to
write a note about a single video: `publishes` has no notes column, which
is the gap FILM-1603 §5 explicitly deferred here.

## 2. Conventions Fixed Here

- **The watched metric is additive, not a replacement.** The existing
  `totals` block stays byte-identical in every snapshot. Anything else
  breaks `ExperimentMetricSnapshot` (`components/experiments/experiment-detail.tsx:9-20`)
  and the six delta rows it renders at `:40-47`, for a change that is
  supposed to add evidence rather than move it.
- **`review_due_at` is derived, never stored by hand.** A generated stored
  column, so it cannot drift from `started_at + review_window_days`.
  `date + integer` is immutable in Postgres, which is what makes a
  generated column legal here and a trigger unnecessary.
- **"Result after N days" reports the N that happened.** `concludeExperimentAction`
  records `resultAfterDays = ended_at − started_at`, so a review on day 74
  is labelled 74. Rendering the *planned* window as though it were the
  actual one is the dishonesty this fixes; it is the same class of error as
  showing an immature checkpoint as a real figure (FILM-1603 §2).
- **A note belongs to a publish, in its own column.** See §4.
- **Notes are not synced to ClickHouse.** The Video Log is a bounded, paged
  read; joining notes from Postgres in the action costs one query and keeps
  free text out of a columnar store that has no way to delete a row.

## 3. Schema — `analytics_experiments`

Edit `apps/web/supabase/schemas/69-analytics-experiments.sql` and generate
the migration with `db diff`.

```sql
alter table public.analytics_experiments
  add column if not exists category varchar(30),
  add column if not exists metric_watched varchar(40),
  add column if not exists review_window_days integer not null default 60,
  add column if not exists notes text,
  add column if not exists connection_id uuid
    references public.platform_connections(id) on delete set null,
  add column if not exists review_due_at date
    generated always as (started_at + review_window_days) stored;

create index if not exists idx_analytics_experiments_review_due
  on public.analytics_experiments (account_id, review_due_at)
  where status = 'running';
```

- **`connection_id` is `on delete set null`**, matching how `project_id`
  already behaves in this table. Cascading would delete the experiment
  record when a channel is disconnected, destroying the history the log
  exists to keep.
- **`review_window_days` is `not null default 60`** so every existing row
  gets a window and `review_due_at` computes for all of them. A nullable
  window would make the generated column null for every historical
  experiment, and the due-for-review list would start empty and stay that
  way.
- **`review_due_at` is null when `started_at` is null**, which is exactly
  right: a `planned` experiment is not due for anything. The partial index
  on `status = 'running'` keeps the list query off the rest.
- **`category` and `metric_watched` are nullable `varchar`**, not enums or
  CHECKs. The vocabulary is not settled — `metric_watched` must name
  something the platform can actually measure, and §5 shows that set grows
  with each spec in this phase. A CHECK constraint here would need a
  migration every time. Validate in zod instead, where the enum lives with
  the code that resolves it.

A generated stored column arrives in the generated types as read-only, so
it must not appear in any insert or update payload.

## 4. Schema — Per-Video Notes

Edit `apps/web/supabase/schemas/30-film-studio.sql` (the `publishes` table,
`:521-559`):

```sql
alter table public.publishes
  add column if not exists analytics_note text,
  add column if not exists analytics_note_updated_at timestamptz,
  add column if not exists analytics_note_updated_by uuid references auth.users(id);
```

**Not `metadata`.** `publishes.metadata` is a shared jsonb written by the
publish pipeline. An analytics-side read-modify-write on it races a
concurrent publish and clobbers platform fields — a lost `platform_content_id`
with no error and no way to tell which write won. A dedicated column has no
such interaction.

**`publishes` has no `updated_at` column at all**, which is why the note
carries its own timestamp rather than relying on the table's. Do not add a
table-wide `updated_at` as a side effect of this spec: it would need a
trigger, and every writer in the publish pipeline would start touching it.

Existing `publishes` RLS governs the new columns — no new policy. **Confirm
the update policy admits the roles that should be able to write a note**
before implementing; if analytics-only collaborators cannot update a
publish, that is a finding for this spec to resolve explicitly, not an
assumption to carry into it.

## 5. Watched Metrics

`captureSnapshot` gains `watched: { metric, value, unit } | null` alongside
the unchanged `totals`. Every source already exists or lands earlier in
this phase:

| `metric_watched` | source |
|---|---|
| `views_at_30d` | `queryVideoViewsAtAge` (FILM-1603) |
| `ctr` | `queryQualityMetricsForVideos` (`queries-detail.ts:156`), view-weighted |
| `avg_view_duration` | same |
| `avg_view_percentage` | same |
| `browse_suggested_share` | `queryTrafficSourceBreakdown` (FILM-1605) |
| `search_share` | same |
| `subscribers_net` | `queryWatchWindowTotals` |

An unrecognised `metric_watched` resolves to `watched: null` and the
snapshot still saves. Failing the whole capture because a metric name was
retired would lose the totals too, which are the part that always works.

## 6. Implementation Map

| File | Change |
|------|--------|
| `apps/web/supabase/schemas/69-analytics-experiments.sql` + migration | §3. |
| `apps/web/supabase/schemas/30-film-studio.sql` + migration | §4. Both migrations regenerate types into **both** `database.types.ts` copies. |
| `packages/features/content-analytics/src/lib/schemas/experiment.schema.ts` | `category`, `metricWatched` (zod enum over §5), `reviewWindowDays` (1–365), `notes`, `connectionId`. Shared by the actions and the forms. |
| `packages/features/content-analytics/src/server/experiment-actions.ts` | `captureSnapshot` (`:47`) takes an optional `metricWatched` and appends `watched`. The `totals` block is untouched — assert this with a fixture comparison, not by eye. |
| ↑ | New `listExperimentsDueForReviewAction` — `status = 'running' and review_due_at <= current_date`, ordered by `review_due_at`, hitting the new partial index. |
| ↑ | `concludeExperimentAction` (`:222`) records `resultAfterDays`. `abandonExperimentAction` (`:249`) continues to write **no** snapshot: an abandoned experiment has no result, and writing one would put a number next to `outcome_status: 'inconclusive'` that invites reading. |
| ↑ | `replaceLinks` (`:91`) and `linkedPublishIds` (`:79`) are unpaged bare selects. They are safe today only because the schema caps `publishIds` at 200 — well under the 1,000-row PostgREST cap FILM-1612 swept. Add the comment saying so, so the next person to raise the cap knows what else moves. |
| `packages/features/content-analytics/src/server/video-log-actions.ts` | `getVideoLogAction` (`:100`) joins `analytics_note` from Postgres for the page of videos it returns — bounded by the same `limit`, so no new pagination concern. `VideoLogRow` gains `analyticsNote`. |
| `packages/features/content-analytics/src/server/publish-notes-actions.ts` | New `updatePublishNoteAction`, setting the note plus its `updated_at` / `updated_by` in one write. |
| `apps/web/app/home/[account]/studio/analytics/experiments/_components/` | Fields for category, watched metric, review window, notes and channel; a "due for review" list. `ExperimentMetricSnapshot` (`experiment-detail.tsx:9-20`) gains an optional `watched` block rendered beneath the existing six deltas. |

## 7. Out of Scope

- **The note *editor* inside the Video Log table** — the action and the
  column land here; the table itself is FILM-1615.
- **Syncing notes into `video_dim`** — see §2.
- **Statistical significance testing** — the log records what was watched
  and what changed; it does not claim the change was significant.
- **Auto-concluding a due experiment** — the list surfaces it; a human
  concludes it.

## 8. Acceptance Criteria

- [ ] `review_due_at` is a generated stored column and cannot be written directly
- [ ] `review_due_at` is null for an experiment that has not started
- [ ] Every pre-existing experiment gets `review_window_days = 60` and a computed `review_due_at`
- [ ] `listExperimentsDueForReviewAction` returns only running experiments at or past their due date, ordered by due date
- [ ] `concludeExperimentAction` records the actual elapsed days, not the planned window
- [ ] The `totals` block of a snapshot is byte-identical to what shipped before this change
- [ ] A snapshot with a recognised `metric_watched` carries a `watched` value with its unit
- [ ] An unrecognised `metric_watched` yields `watched: null` and still saves the totals
- [ ] `abandonExperimentAction` still writes no snapshot
- [ ] Disconnecting a channel nulls `connection_id` and leaves the experiment row intact
- [ ] `publishes.analytics_note` is a column, and nothing writes notes into `publishes.metadata`
- [ ] A note write sets `analytics_note_updated_at` and `analytics_note_updated_by`
- [ ] A user without update rights on a publish cannot write its note
- [ ] Notes are absent from every ClickHouse insert
- [ ] `pnpm --filter web check:schema-drift` passes and both `database.types.ts` copies match

## 9. Verification

```bash
pnpm --filter web supabase migration up
pnpm supabase:web:typegen
pnpm --filter web check:schema-drift
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
```

The Postgres half is genuinely verifiable: the generated column, the
partial index, the backfill of `review_window_days` and the RLS behaviour
all run for real in the `supabase-db` CI job, which applies every migration
from scratch against live PostgREST.

The snapshot half is not. Every watched-metric source is a ClickHouse
query, and `CLICKHOUSE_ENABLED=false` in production — so `watched` will be
present, shaped correctly, and zero. A green suite proves the plumbing and
the fallback, not the value.

## 10. Risk

Two migrations, one of them on `publishes` — a table the publish pipeline
writes on a hot path. Adding nullable columns is metadata-only in Postgres
and takes no table rewrite, but it is the one change in this phase that
touches a table outside analytics. It only adds columns; nothing existing
is altered, dropped or re-typed, and no existing writer sees a new NOT NULL.
