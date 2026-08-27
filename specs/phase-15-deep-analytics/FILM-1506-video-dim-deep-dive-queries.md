---
spec_id: FILM-1506
title: Video Dimension Table & Deep-Dive Query Layer
status: Approved
effort: L
dependencies: FILM-1502, FILM-1504, FILM-1505
---

# Video Dimension Table & Deep-Dive Query Layer

## 1. Overview

ClickHouse currently carries no dimensions beyond `project_id / video_id / platform / metric_date`, making age-controlled and segment analytics impossible. This spec adds a `video_dim` dimension table synced from Postgres, then builds the playbook's deep-dive computations on top: **medians, rolling 90-day, traffic share, back-catalog contribution, cohort curves, YPP progress, returning-viewer proxy**.

## 2. ClickHouse Schema — `005_video_dim.ts`

```sql
CREATE TABLE video_dim (
    video_id String,                 -- publish uuid
    project_id UUID, account_id UUID, episode_id UUID,
    platform LowCardinality(String),
    content_type LowCardinality(String),
    language LowCardinality(String),
    title String,
    published_at DateTime,
    duration_seconds UInt32,         -- via provider.getVideoInfo
    tags Array(String),              -- 'dimension:slug' strings, filled by FILM-1507
    updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (video_id);
```

**Sync** — `packages/features/content-analytics/src/server/dim-sync.ts`, `upsertVideoDims(publishIds?)` joining `publishes → episodes → projects(account_id)`. Called from:
1. Publish-success path in `packages/features/publishing/src/server/publish-actions.ts`
2. Nightly full-table reconcile inside the hourly sync run (`hour === 2` guard; `publishes` has **no `updated_at`** column, so full upsert — Replacing dedups)
3. The FILM-1503 backfill route

## 3. Query Layer — `packages/clickhouse/src/queries-advanced.ts`

All gated by `isClickHouseEnabled` + `assertScopedFilters`, joining `video_dim FINAL`:

| Function | Computation |
|----------|-------------|
| `queryMedianViewsPerVideo({ buckets, mode })` | `quantileExact(0.5)` + p25/p75 per bucket. Modes: `'cohort_views_to_date'` (**default headline** — per upload month, median of cumulative views so far) and `'views_in_period'`. |
| `queryRollingViews({ windowDays: 90 })` | `sum(views) OVER (ORDER BY metric_date ROWS BETWEEN 89 PRECEDING AND CURRENT ROW)`. |
| `queryTrafficShareTrend({ bucket })` | `sumIf(views, source IN ('BROWSE','SUGGESTED')) / sum(views)` per bucket from `video_traffic_sources` (+ per-source series). |
| `queryBackCatalogShare({ ageDays: 90 })` | Share of period views where `dateDiff('day', dim.published_at, metric_date) > ageDays`. |
| `queryCohortCurves({ cohort: 'quarter', checkpoints: [30,90,180,365] })` | Per `toStartOfQuarter(published_at)` cohort: `sumIf(views, age <= cp)` per checkpoint, normalized per cohort video count. |
| `queryWatchHoursWindow({ windowDays: 365 })` | Rolling watch hours + net subscribers. **Includes `channel_daily`** so YPP watch-hours are channel-accurate. |
| `queryMedianByTag({ dimension, minVideos })` | Median performance grouped by `video_dim.tags` entries of one dimension (shared with FILM-1507). |

## 4. Settings — `apps/web/supabase/schemas/67-analytics-settings.sql`

```sql
create table if not exists public.analytics_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  ypp_target_watch_hours integer not null default 4000,
  ypp_target_subscribers integer not null default 1000,
  tag_min_sample integer not null default 5,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: has_role_on_account(account_id)
```

## 5. Server Actions — `deep-dive-actions.ts`

`getMedianPerformanceAction`, `getRolling90Action`, `getTrafficShareTrendAction`, `getBackCatalogAction`, `getCohortCurvesAction`, `getYppProgressAction` (watch-hours window ÷ settings targets), `getReturningViewerProxyAction` (subscribed-vs-unsubscribed share trend from FILM-1505 columns).

All `enhanceAction` + Zod schemas in `_lib/schemas`, authz copied from `dashboard-actions.ts`.

> [!NOTE]
> Neither the Analytics nor the Reporting API exposes new-vs-returning viewers (Studio-only). The subscribed-share proxy is the documented best-available; re-verify `reportTypes.list` once at implementation time in case later API additions changed this.

## 6. Acceptance Criteria

- [ ] `video_dim` rows exist for all published publishes; publish-success keeps it fresh; nightly reconcile heals drift
- [ ] Median (both modes), rolling-90, traffic share, back-catalog, cohort, YPP, returning-proxy queries return hand-verified values on fixtures
- [ ] Monthly median ≤ mean on right-skewed fixture data (sanity)
- [ ] Cohort curves are age-aligned (Q3 cohort at 90d comparable to Q1 cohort at 90d)
- [ ] `analytics_settings` defaults apply when no row exists

## 7. Verification

```bash
pnpm --filter @kit/clickhouse migrate && pnpm --filter @kit/clickhouse test  # fixture math
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test
```
