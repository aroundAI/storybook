---
spec_id: FILM-1610
title: Experiment Log & Per-Video Notes
status: ✅ DONE
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

Write the migration by hand in `apps/web/supabase/migrations/`, then mirror
it into `apps/web/supabase/schemas/69-analytics-experiments.sql`. **Do not
generate it with `db diff`**: `schemas/` is missing a third of the tables
the migrations create, so a diff proposes dropping them (root `CLAUDE.md`,
"Do not run `supabase db diff` in this repo").

```sql
alter table public.analytics_experiments
  add column if not exists category varchar(30),
  add column if not exists metric_watched varchar(40),
  add column if not exists review_window_days integer not null default 60,
  add column if not exists notes text,
  add column if not exists connection_id uuid,
  add column if not exists review_due_at date
    generated always as (started_at + review_window_days) stored;

alter table public.analytics_experiments
  add constraint analytics_experiments_review_window_days_check
  check (review_window_days between 1 and 365);

alter table public.analytics_experiments
  add constraint analytics_experiments_connection_account_fkey
  foreign key (connection_id, account_id)
  references public.platform_connections (id, account_id)
  on delete set null (connection_id);

create index if not exists idx_analytics_experiments_review_due
  on public.analytics_experiments (account_id, review_due_at)
  where status = 'running';
```

- **`connection_id` is `on delete set null`**, matching how `project_id`
  already behaves in this table. Cascading would delete the experiment
  record when a channel is disconnected, destroying the history the log
  exists to keep.
- **`connection_id` is a composite key onto `(id, account_id)`** —
  *corrected during implementation.* A plain foreign key does not run RLS,
  so a member of account A could attach account B's channel: the FILM-1608
  hole, fixed the same way. And the delete action must be
  `set null (connection_id)`, not a bare `set null`, which on a composite key
  nulls `account_id` too and makes disconnecting a channel fail on its NOT
  NULL. Both were watched failing in pgTAP without the fix.
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

A second hand-written migration, mirrored into
`apps/web/supabase/schemas/30-film-studio.sql` (the `publishes` table,
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

*Rewritten during implementation. The table this section first shipped
with sourced three metrics from scope-level queries and weighted CTR by
views; both are corrected below.*

`captureSnapshot` gains `watched: WatchedValue | null` alongside the
unchanged `totals`. `null` means the experiment watches no metric.
`WatchedValue` is a discriminated union
(`lib/watched-metrics.ts`): `measured`, with the value, its unit, the
window and how many of the linked videos had data; or `unmeasured`, with
the reason — `no_linked_videos`, `no_data`, `none_mature` or
`unknown_metric`. **A metric that cannot be measured is never a zero**,
and the type makes one impossible to construct without a value.

**Every metric is measured over the experiment's linked videos only.**
`queryTrafficSourceBreakdown` and `queryWatchWindowTotals`, which the first
draft named, take a project or account scope: they would have measured the
whole channel for an experiment run on six videos.

| `metric_watched` | source | pooled across the videos as |
|---|---|---|
| `views_at_30d` | `queryVideoViewsAtAge({ videoIds, checkpoints: [30] })` | median of the videos whose 30 days have elapsed; `none_mature` if none have |
| `ctr` | `queryQualityMetricsForVideos({ videoIds, …window })` | Σ(ctr × impressions) / Σ impressions — **impression**-weighted, since CTR is clicks per impression |
| `avg_view_duration`, `avg_view_percentage` | same, plus windowed views from `queryTotalsByVideoIds` | weighted by each video's views in the window |
| `browse_suggested_share`, `search_share` | `queryTrafficSources({ videoIds, …window, byVideo })` | group views / total views, through `groupForSource` (FILM-1605) |
| `subscribers_net` | new `queryNetSubscribersForVideos` | Σ gained − Σ lost |

**Windows.** Lifetime figures would dilute a change with every day before
it. The baseline covers the `review_window_days` days *before*
`started_at`; the result covers `started_at` to `ended_at`, both
inclusive. `views_at_30d` is age-bounded already and records a null
window. The `totals` block stays lifetime and byte-identical.

An unrecognised `metric_watched` resolves to `unmeasured: unknown_metric`
and the snapshot still saves. Failing the whole capture because a metric
name was retired would lose the totals too, which are the part that
always works.

**Linking videos.** The shipped form hard-coded `publishIds: []`, so every
experiment logged from the UI measured zero videos. The form now has a
video picker over the account's published videos. Linking also got a
tenant check it lacked: `experiment_publishes` checked access to the
*experiment* only, so any publish id could be linked and ClickHouse — which
has no RLS — would report its figures. Links must now belong to the
experiment's account, and snapshots read only linked publishes the caller
can see.

### 5a. Corrections from the post-implementation review

A full review of the first version found problems it had shipped green.
Each fix below was watched failing before it was believed.

- **The comparison is protected.** An experiment starts only from `planned`
  and concludes only from `running`, never with an end before its start
  (`lib/experiment-transitions.ts`). Once started, `metricWatched`,
  `reviewWindowDays` and the linked videos are frozen: the baseline was
  measured over them. The detail view labels the watched block from what
  the snapshots recorded, and says so when baseline and result disagree.
- **The table refuses a cross-account link**, not only the action
  (migration `20260918203816`, `experiment-publishes-account-rls.test.sql`):
  PostgREST is reachable directly.
- **Coverage is stated.** A measured value records `daysWithData` of
  `windowDays`, counted by `queryDataDaysForVideos`. The page says "data on N
  of M days" when that is partial, and a **sum** (`subscribers_net`) is also
  shown per day of data, since a sum grows with its window.
- **`views_at_30d` leaves out a video whose 30 days closed before ingest
  began** (FILM-1603's `checkpointPredatesIngest`); when only those remain,
  the reason is `predates_ingest`. Counted, they pulled the median to zero.
- **Failures are reported.** Link writes and reads that failed were
  discarded, so a refused link left an experiment with no videos behind a
  success toast; a failed list read looked like an empty log.
- **Dates are the user's.** Start, conclude and "due as of" take the
  browser's local date; the server's UTC date recorded a start just after
  local midnight on the previous day for anyone east of UTC.
- **`canEditNote`** on each Video Log row, from the `publishes_update` roles,
  so FILM-1615 can render a note read-only where it cannot be written.
- **Every ClickHouse query now runs in `verify`**, and
  `verify-coverage.test.ts` fails when one does not. Three had never run
  against a server, one of them this spec's.

**Round 2**, reviewed by class rather than by file — each class checked at
every place it occurs:

- **Abandon had no rule**, so it could overwrite a concluded experiment's
  result. It now takes planned or running only.
- **Lifecycle writes are atomic.** Start, conclude and abandon each carry
  their status condition on the update itself; a check followed by a write
  let two tabs both start an experiment, the second replacing the first's
  baseline.
- **Replacing links is one transaction** (`replace_experiment_publishes`):
  as a delete then an insert, a refused insert left an experiment with no
  videos.
- **The table enforces what the actions do:** the metric and window freeze
  on start (trigger), and links change only while planned (policy).
- **Audit fields are the database's.** The note's author and time, and an
  experiment's creator, are set by triggers; a caller could claim either.
  The note trigger lets a foreign-key cascade through, or deleting a user
  who wrote a note would fail — which the existing deletion test caught.
- **Editability is one rule.** `editable_publish_ids` replaces a role list
  restated in TypeScript, and pgTAP checks it against a real update for a
  project member, a viewer, an account member off the project and an
  outsider.
- The experiment list is paged; a failed cleanup after a failed link is
  reported; the due list's cache key carries its date.

## 6. Implementation Map

| File | Change |
|------|--------|
| `apps/web/supabase/migrations/<timestamp>_analytics-experiments-watched.sql` | §3, hand-written. Mirrored into `schemas/69-analytics-experiments.sql`. |
| `apps/web/supabase/migrations/<timestamp>_publishes-analytics-note.sql` | §4, hand-written. Mirrored into `schemas/30-film-studio.sql`. `pnpm supabase:web:typegen` then writes **both** `database.types.ts` copies — generated, never hand-edited. |
| `apps/web/supabase/tests/database/publish-analytics-note-rls.test.sql` | New pgTAP test for the note-write criterion in §8: a member who can update the publish writes the note; a user who cannot is refused. No policy changes, but the criterion is a claim about RLS, and RLS is verified by running it, not by reading it. |
| `packages/features/content-analytics/src/lib/schemas/experiment.schema.ts` | `category`, `metricWatched` (zod enum over §5), `reviewWindowDays` (1–365), `notes`, `connectionId`. Shared by the actions and the forms. |
| `packages/features/content-analytics/src/server/experiment-actions.ts` | `captureSnapshot` (`:47`) takes an optional `metricWatched` and appends `watched`. The `totals` block is untouched — assert this with a fixture comparison, not by eye. |
| ↑ | New `listExperimentsDueForReviewAction` — `status = 'running' and review_due_at <= current_date`, ordered by `review_due_at`, hitting the new partial index. |
| ↑ | `concludeExperimentAction` (`:222`) records `resultAfterDays`. `abandonExperimentAction` (`:249`) continues to write **no** snapshot: an abandoned experiment has no result, and writing one would put a number next to `outcome_status: 'inconclusive'` that invites reading. |
| ↑ | `replaceLinks` (`:91`) and `linkedPublishIds` (`:79`) are unpaged bare selects. They are safe today only because the schema caps `publishIds` at 200 — well under the 1,000-row PostgREST cap FILM-1612 swept. Add the comment saying so, so the next person to raise the cap knows what else moves. |
| `packages/features/content-analytics/src/server/video-log-actions.ts` | `getVideoLogAction` (`:100`) joins `analytics_note` from Postgres for the page of videos it returns — bounded by the same `limit`, so no new pagination concern. `VideoLogRow` gains `analyticsNote`. |
| `packages/features/content-analytics/src/server/publish-notes-actions.ts` | New `updatePublishNoteAction`, setting the note plus its `updated_at` / `updated_by` in one write. |
| `apps/web/app/home/[account]/studio/analytics/experiments/_components/` | Fields for category, watched metric, review window, notes and channel; a "due for review" list. `ExperimentMetricSnapshot` (`experiment-detail.tsx:9-20`) gains an optional `watched` block rendered beneath the existing six deltas. |
| `packages/features/content-analytics/src/lib/watched-metrics.ts` | *Added in implementation.* The registry, the `WatchedValue` union and every fold, pure. |
| `packages/features/content-analytics/src/server/watched-metric-snapshot.ts` | *Added in implementation.* Fetches over the linked videos and folds. |
| `packages/clickhouse/src/queries-detail.ts` | *Added in implementation.* `queryNetSubscribersForVideos`. |
| `packages/features/content-analytics/src/components/experiments/video-picker.tsx` | *Added in implementation.* The picker, fed by `listLinkablePublishesAction`. |

## 7. Out of Scope

- **The note *editor* inside the Video Log table** — the action and the
  column land here; the editable cell belongs to FILM-1615, which owns the
  table. Land this spec first, so FILM-1615 ships the editor instead of
  leaving the column out and needing a follow-up.
- **Syncing notes into `video_dim`** — see §2.
- **Statistical significance testing** — the log records what was watched
  and what changed; it does not claim the change was significant.
- **Auto-concluding a due experiment** — the list surfaces it; a human
  concludes it.

## 8. Acceptance Criteria

- [x] `review_due_at` is a generated stored column and cannot be written directly
- [x] `review_due_at` is null for an experiment that has not started
- [x] Every pre-existing experiment gets `review_window_days = 60` and a computed `review_due_at` — by the column default, which `ADD COLUMN … NOT NULL DEFAULT` writes to every existing row; pgTAP checks the default, not a pre-migration row
- [x] `listExperimentsDueForReviewAction` returns only running experiments at or past their due date, ordered by due date
- [x] `concludeExperimentAction` records the actual elapsed days, not the planned window
- [x] The `totals` block of a snapshot is byte-identical to what shipped before this change
- [x] A snapshot with a recognised `metric_watched` carries a `watched` value with its unit
- [x] An unrecognised `metric_watched` yields `unmeasured: unknown_metric` (was: `watched: null`, which now means *no metric chosen*) and still saves the totals
- [x] `abandonExperimentAction` still writes no snapshot
- [x] Disconnecting a channel nulls `connection_id` and leaves the experiment row intact
- [x] `publishes.analytics_note` is a column, and nothing writes notes into `publishes.metadata`
- [x] A note write sets `analytics_note_updated_at` and `analytics_note_updated_by`
- [x] A user without update rights on a publish cannot write its note — proved by a pgTAP test, not by reading the policy
- [x] Notes are absent from every ClickHouse insert — `dim-sync.ts` selects an explicit column list and `VideoDim` has no note field, so the type is the guard
- [x] `pnpm --filter web check:schema-drift` passes and both `database.types.ts` copies match
- [x] An experiment starts only from planned, concludes only from running and never before its start, is abandoned only from planned or running, and once started cannot have its metric, window or videos changed — each enforced by the table as well as the action (§5a). Concluding before the review date is allowed: the date says when to look, not when you may
- [x] The table refuses a link to another account's video, for a user who belongs to both (pgTAP)
- [x] A partially covered window says so on the page, and a sum is also shown per day (measured against local ClickHouse: +15, data on 3 of 30 days, 5.0 per day)
- [x] A video whose 30 days predate ingest is excluded from `views_at_30d` (measured: 100 with 1 of 2 videos; 50 with 2 of 2 when the exclusion is reverted)
- [x] A failed link write, link read or list read is reported, never shown as success or emptiness
- [x] Dates are recorded in the user's local calendar (E2E in `Asia/Kolkata` just after midnight)
- [x] Both notes are bounded at 5,000 characters by the table, not only by zod

## 9. Verification

```bash
pnpm --filter web supabase migration up
pnpm supabase:web:typegen
pnpm --filter web check:schema-drift
pnpm --filter web supabase:test          # pgTAP, including the note-write test
pnpm --filter @kit/content-analytics test
pnpm typecheck && pnpm lint
npx playwright test experiments      # from apps/e2e
```

**A Playwright spec is required for the experiment form.** It gains five
fields — category, watched metric, review window, notes and channel — and
that is the FILM-1609 shape: defects that live between the DOM and form
state, invisible to unit tests, appearing on the *second* submission after a
`reset()`. Seed through the API, save an experiment, then save a second one
and assert every new field holds the second value, not the first or a
default. The channel `Select` is uncontrolled Radix unless made otherwise,
which is one of the four FILM-1609 defects. This half is Postgres-only and
runs in CI in full. Screenshots of the form after the second save and of the
due-for-review list go in the PR.

Built as `apps/e2e/tests/experiments/`. Two guards were watched failing
with their fix reverted: an uncontrolled metric select kept "Impressions
click-through rate" on screen after the reset, and a cleared review window
fell back to 60 instead of being refused.

The Postgres half is genuinely verifiable: the generated column, the
partial index, the backfill of `review_window_days` and the RLS behaviour
all run for real in the `supabase-db` CI job, which applies every migration
from scratch against live PostgREST.

The snapshot half is not. Every watched-metric source is a ClickHouse
query, and `CLICKHOUSE_ENABLED=false` in production — so `watched` will be
`unmeasured: no_data`, and the detail view says so in words (*corrected:
the first draft said it would be zero, which is the confusion the union
exists to prevent*). The folds are unit-tested with fixture rows, and one
metric was measured end to end against the local ClickHouse
(`./scripts/local-env.sh`): `experiments-evidence.spec.ts` seeds 1,000
impressions at 10% and 9,000 at 2% on two linked videos, and the started
experiment's baseline reads **2.8%** on the page over the right window, 2 of 2
videos covered. With CTR reverted to a plain mean it reads 6.0% and the spec
fails. `subscribers_net` (partial coverage) and `views_at_30d` (pre-ingest
exclusion) are measured the same way. The remaining four metrics
(`avg_view_duration`, `avg_view_percentage` and the two traffic shares) have
their SQL run against ClickHouse in `verify` — executed, not value-asserted —
and their folds unit-tested, but were not driven through the page.

## 10. Risk

Two migrations, one of them on `publishes` — a table the publish pipeline
writes on a hot path. Adding nullable columns is metadata-only in Postgres
and takes no table rewrite, but it is the one change in this phase that
touches a table outside analytics. It only adds columns; nothing existing
is altered, dropped or re-typed, and no existing writer sees a new NOT NULL.
