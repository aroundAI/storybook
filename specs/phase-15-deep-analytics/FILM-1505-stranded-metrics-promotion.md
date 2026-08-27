---
spec_id: FILM-1505
title: Promote Stranded Metrics to Queryable Schema
status: Approved
effort: M
dependencies: FILM-1502, FILM-1504
---

# Promote Stranded Metrics to Queryable Schema

## 1. Overview

The v1 sync fetched rich YouTube data — retention curves, demographics, geography, device/OS, subscribed status, avg view duration, ad-vs-Premium revenue split — then serialized it into the `extra_metrics` JSON blob where **nothing ever read it back** (`getProjectAudienceData` and report retention columns are dead code returning null). This spec promotes every stranded metric into queryable ClickHouse schema and revives the dead consumers.

> [!IMPORTANT]
> Retention curves and audience breakdowns are **lifetime aggregates** keyed without a date (latest fetch wins). Do not build daily trends on them.

## 2. ClickHouse Schema — `004_extended_metrics.ts`

```sql
ALTER TABLE video_metrics
  ADD COLUMN avg_view_duration_seconds Float32,
  ADD COLUMN avg_view_percentage Float32,
  ADD COLUMN dislikes UInt32,
  ADD COLUMN subscribers_lost Int32,
  ADD COLUMN ad_revenue_cents Int64,
  ADD COLUMN red_revenue_cents Int64,
  ADD COLUMN subscribed_views UInt64,
  ADD COLUMN unsubscribed_views UInt64;
-- (recreate the video_daily_stats compatibility view to include new columns)

CREATE TABLE video_retention_curves (
    project_id UUID, video_id String, platform Enum(...),
    elapsed_ratio Float32,          -- 0..1 position in the video
    audience_watch_ratio Float32,   -- share of starters still watching
    fetched_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (project_id, platform, video_id, elapsed_ratio);

CREATE TABLE video_audience (
    project_id UUID, video_id String, platform Enum(...),
    dimension LowCardinality(String),  -- age_gender | country | city | device | os | follower_status
    key String,
    views UInt64, percentage Float32,
    fetched_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (project_id, platform, video_id, dimension, key);
```

## 3. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/server/analytics-sync-cron.ts` | Ingest fns populate the new columns/tables from the `NormalizedAnalytics` fields already computed and currently dropped. TikTok percentage traffic sources → `views = pct × totals`, `watch_time_minutes = 0`, into `video_traffic_sources` (FILM-1504 table). |
| `packages/clickhouse/src/queries-detail.ts` | New: `queryRetentionCurve({ videoId })`, `queryAudience({ projectId \| videoIds, dimension, dateRange })`, `queryTrafficSources({ projectId, dateRange, groupBy })`. |
| `packages/features/content-analytics/src/server/aggregation-queries.ts` | Un-dead `getProjectAudienceData` (points at `queryAudience`, view-weighted aggregation actually runs). |
| `packages/features/content-analytics/src/server/language-analytics.ts` | Un-dead `getGeographyByLanguage` via `queryAudience(dimension: 'country')`. |

## 4. Acceptance Criteria

- [ ] One `syncSinglePublishById` run populates: extended `video_metrics` columns, `video_retention_curves`, `video_audience`, `video_traffic_sources`
- [ ] `getProjectAudienceDataAction` returns real demographics/geography (Audience tab shows data)
- [ ] `getGeographyByLanguage` returns per-country rows
- [ ] Re-sync replaces (not duplicates) retention curve points and audience rows
- [ ] YouTube ad vs Premium revenue lands in `ad_revenue_cents` / `red_revenue_cents`

## 5. Verification

```bash
pnpm --filter @kit/clickhouse migrate && pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
# Manual: trigger manualSyncAction for one publish, inspect all four tables; open Audience tab.
```
