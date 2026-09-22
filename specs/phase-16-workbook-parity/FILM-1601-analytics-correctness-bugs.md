---
spec_id: FILM-1601
title: Analytics Correctness Bugs & Revenue Delete RLS
status: 🟡 PARTIAL
audited: 2026-09-23
effort: M
dependencies: FILM-1506, FILM-1508
---

# Analytics Correctness Bugs & Revenue Delete RLS

## 1. Overview

A gap-check of Phase 15 against the *YouTube Channel Metrics Tracker* workbook found eight correctness defects, one of them introduced by Phase 15 itself. Each produces a **plausible-looking wrong number** rather than an error, so none of them surface without reading the source. This spec is isolated and revertable: bug fixes only, no new features.

Shipped in PR #232 (folded into the Phase 15 PR rather than shipped separately).

## 2. Defects Fixed

| # | Site | Defect |
|---|------|--------|
| 1 | `revenue-actions.ts` | `publishes!inner` silently excluded channel-level revenue rows (`publish_id` NULL) from `totalRevenueCents`, `byType` and `rpm` — defeating the channel-level sponsorship/product feature FILM-1508 had just added. Same join in the prior-period trend query. |
| 2 | `csv-parsers.ts` | `subscribersGained += gained - lost`, so a column named `subscribers_gained` stored a **net** value. Both indices were already resolved, so keeping the split was free. |
| 3 | `38-revenue-tracking.sql` | The delete policy had no `account_id` branch, making channel-level revenue rows **un-deletable**. |
| 4 | `revenue-actions.ts` | The RPM denominator counted only publishes that *have* a revenue row, inflating RPM. |
| 5 | `api/reports/scheduled/route.ts` | The raw CSV shipped `impressions: 0`, `topTrafficSource: ''`, `tags: ''` hardcoded and reused one period-wide CTR/AVD per day — 4 of 21 columns were non-data. |
| 6 | `queries-advanced.ts` | `cohort_views_to_date` bounded `total_views` by the metric date range, understating older upload buckets. Latent only because `DeepDiveTab` passed no dates. |
| 7 | `queries-advanced.ts` | `count(DISTINCT m.video_id)` omitted videos with no metric rows, inflating `viewsPerVideo`. |
| 8 | `taxonomy-actions.ts` | The 30-video gate counted tag **assignments**, so 8 videos × 4 tags passed it. |

## 3. Implementation Map

| File | Change |
|------|--------|
| `revenue-queries.ts` (later extracted) | `fetchAccountRevenueRows()` — PostgREST cannot express an `OR` across an embedded resource, so the channel-scoped (`.is('publish_id', null).eq('account_id', …)`) and publish-scoped halves are queried separately and merged in TS. Callers: `getRevenueSummaryAction` (main + trend), `getRevenueProjectionAction`, `getRevenueTimeSeriesAction`. `getTopContentByRevenueAction` stays publish-only, correctly. |
| `revenue-actions.ts` | `fetchAccountPublishIds()` — RPM denominator counts every published video in the window, not only revenue-bearing ones. |
| `006_gross_subscribers.ts` | Adds `video_metrics.subscribers_lost`, `channel_daily.subscribers_gained/lost`. No backfill needed and arithmetically safe: old rows keep net in `gained` with `lost = 0`, so `gained - lost` is correct across the boundary. `queryWatchWindowTotals` uses the difference. |
| `38-revenue-tracking.sql` | Delete policy mirrors create/update with the `account_id is not null and has_account_access(...)` branch. |
| `queries-advanced.ts` | `LEFT JOIN` from the dim side so zero-metric videos count in the denominator; `cohort_views_to_date` filters *which uploads* by `published_at` rather than bounding metric days. |
| `68-content-taxonomy.sql` | New `count_tagged_publishes(account_id)` counting **distinct** publishes; `taxonomy-actions.ts` calls it via `client.rpc(...)`. |
| `api/reports/scheduled/route.ts` | Per-day impressions from `video_reach_daily`; top source from `queryTrafficSources({ byDate: true })`. |

## 4. Acceptance Criteria

- [x] Channel-level revenue rows appear in `totalRevenueCents`, `byType` and the trend comparison
- [x] `subscribers_gained` stores gross; net is derived as `gained - lost`
- [ ] ~~Channel-level revenue rows are deletable by `has_account_access` holders~~ — *audit: retired* — narrowed on purpose to owner or author of a manual row in 967160fa (#256); channel rows stay deletable: `apps/web/supabase/migrations/20260916010318_revenue-records-source-and-authorship.sql:65`
- [x] RPM denominator includes published videos that earned nothing
- [x] `cohort_views_to_date` is bounded by upload date, not metric date (unit-tested)
- [x] `viewsPerVideo` counts videos with no metric rows — *audit:* field replaced by cohort medians (1b02afde), still a LEFT JOIN from the dimension side: `packages/clickhouse/src/queries-advanced.ts:737`; test `packages/clickhouse/__tests__/queries-advanced.test.ts:959`
- [x] The taxonomy gate counts distinct tagged videos, not assignments
- [ ] Raw CSV ships real impressions, top traffic source and tags — *audit: not met* — source and tags are per-day, but every daily row carries the video's period-total impressions (`apps/web/app/api/reports/scheduled/route.ts:517`), as shipped in d8c635c1

## 5. Verification

```bash
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
pnpm typecheck && pnpm lint
```

## 6. Risk

The RLS change is the only one reaching outside analytics. It only **widens** permission, and only to `has_account_access` holders, matching the already-shipped create/update policies.

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Raw CSV ships real impressions | Each per-day row's `impressions` is the video's total for the whole report period (`queryQualityMetricsForVideos`, `apps/web/app/api/reports/scheduled/route.ts:247,517`), so summing the column multiplies it by the day count; per-day figures exist in `video_reach_daily` but are not read. CTR and AVD are likewise period rates on daily rows (`:518-519`) | unassigned |
