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

Only semantically **per-day** values become `video_metrics` columns.
Window/lifetime aggregates (subscribed status, demographics, geography,
devices) live in `video_audience` where latest-wins semantics are correct;
the ad/premium revenue split lives in `revenue_records` (FILM-1508).

```sql
ALTER TABLE video_metrics
  ADD COLUMN avg_view_duration_seconds Float32,
  ADD COLUMN avg_view_percentage Float32,
  ADD COLUMN dislikes UInt32;
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
    dimension LowCardinality(String),  -- age_group | gender | country | city | device | os | follower_status
    key String,
    views UInt64, percentage Float32,
    fetched_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (project_id, platform, video_id, dimension, key);
```

> [!NOTE]
> Analytics-API traffic sources are **not** written to `video_traffic_sources`:
> they are window totals without a date dimension, and inserting them under a
> fetch date would collide with (and replace) the Reporting API's real per-day
> rows. `video_traffic_sources` is Reporting-API-only; the Analytics payload's
> traffic sources remain available in `extra_metrics`.

## 3. Implementation Map

| File | Change |
|------|--------|
| `packages/features/content-analytics/src/server/ingest.ts` | `buildRetentionPoints` + `buildAudienceRows` pure builders (unit-tested); YouTube daily rows carry per-day `avg_view_duration_seconds`. |
| `packages/features/content-analytics/src/server/analytics-sync-cron.ts` | YouTube ingest writes retention curves + audience rows; TikTok/Instagram ingest writes audience rows (incl. IG follower-reach as follower_status). |
| `packages/features/content-analytics/src/server/reporting/csv-parsers.ts` | channel_basic rows gain dislikes + view-weighted avg view duration/percentage, populated onto Reporting-API metric rows. |
| `packages/clickhouse/src/queries-detail.ts` | New: `insertRetentionCurves`, `insertVideoAudience`, `queryRetentionCurve({ videoId })`, `queryAudienceRows({ videoIds, dimension })`, `queryTrafficSources({ videoIds, … })`. |
| `packages/features/content-analytics/src/server/aggregation-queries.ts` | Un-dead `getProjectAudienceData` (view-weighted aggregation over `queryAudienceRows` actually runs). |
| `packages/features/content-analytics/src/server/language-analytics.ts` | Un-dead `getGeographyByLanguage` via `queryAudienceRows(dimension: 'country')`. |

## 4. Acceptance Criteria

- [ ] One `syncSinglePublishById` run populates: extended `video_metrics` columns, `video_retention_curves`, `video_audience`
- [ ] `getProjectAudienceDataAction` returns real demographics/geography (Audience tab shows data)
- [ ] `getGeographyByLanguage` returns per-country rows
- [ ] Re-sync replaces (not duplicates) retention curve points and audience rows
- [ ] YouTube ad vs Premium revenue split reaches `revenue_records` categories (FILM-1508)

## 5. Verification

```bash
pnpm --filter @kit/clickhouse migrate && pnpm --filter @kit/clickhouse test
pnpm --filter @kit/content-analytics test
# Manual: trigger manualSyncAction for one publish, inspect all four tables; open Audience tab.
```
