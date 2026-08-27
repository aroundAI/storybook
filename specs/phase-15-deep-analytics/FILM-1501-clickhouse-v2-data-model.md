---
spec_id: FILM-1501
title: ClickHouse v2 Data Model & Migration Runner
status: ✅ DONE
effort: M
dependencies: FILM-1201
---

# ClickHouse v2 Data Model & Migration Runner

## 1. Overview

Replaces the corrupt v1 analytics data model with an idempotent, true-daily model, and introduces a real migration runner for the `@kit/clickhouse` package.

### The v1 bug this fixes

The v1 sync inserts one row per sync run with `metric_date = sync date` into `video_metrics`, and `video_daily_stats` is a `SummingMergeTree` materialized view that **sums** those rows per day. Because:

- TikTok and Instagram providers return **lifetime cumulative** counters, and
- YouTube is fetched over an overlapping 2-day window, and
- day-one videos sync **hourly** (`schedule.ts`),

every dashboard number is over-counted — up to ~24× for new videos. The existing data is unrecoverable and is dropped by this migration (sanctioned decision; re-population is FILM-1503).

## 2. Target Schema

Semantics change: **`video_metrics` holds one row per (video, platform, day) with TRUE DAILY values**, idempotently re-insertable. Late, restated, or duplicate data replaces the row via `ReplacingMergeTree` instead of corrupting sums.

```sql
CREATE TABLE video_metrics (
    project_id UUID,
    video_id String,                -- publish UUID (existing convention)
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,               -- the PLATFORM DATA DATE, never the sync date
    views UInt64,
    likes UInt32,
    comments UInt32,
    shares UInt32,
    saves UInt32,
    watch_time_seconds UInt64,
    revenue_cents Int64,
    subscribers_gained Int32,
    metric_source Enum('analytics_api' = 1, 'reporting_api' = 2, 'snapshot_delta' = 3, 'backfill' = 4),
    inserted_at DateTime DEFAULT now(),
    extra_metrics String DEFAULT '{}'
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_date);
```

```sql
-- Lifetime cumulative snapshots: delta baselines for TikTok/Instagram
CREATE TABLE video_snapshots (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    snapshot_date Date,
    fetched_at DateTime DEFAULT now(),
    views UInt64,
    likes UInt32,
    comments UInt32,
    shares UInt32,
    saves UInt32,
    watch_time_seconds UInt64,
    subscribers_gained Int32
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (project_id, platform, video_id, snapshot_date);
```

```sql
-- Compatibility view: existing queries.ts readers keep working unchanged
CREATE VIEW video_daily_stats AS
SELECT project_id, video_id, platform, metric_date,
       views, likes, comments, shares, saves,
       watch_time_seconds, revenue_cents, subscribers_gained
FROM video_metrics FINAL;
```

> [!IMPORTANT]
> New metric families (reach, traffic sources, retention, audience) go in **sibling tables** (FILM-1504/1505), never as columns re-inserted partially on this key — a partial row under ReplacingMergeTree would clobber the full row.

## 3. Implementation Map

| File | Change |
|------|--------|
| `packages/clickhouse/src/migrations/002_metrics_v2.ts` | New. Drops `video_daily_stats` (MV) and `video_metrics`, creates v2 tables + view. Records itself in `_migrations`. |
| `packages/clickhouse/src/migrations/run.ts` | New. Generic runner: reads `_migrations`, applies pending migration modules in filename order. |
| `packages/clickhouse/src/migrations/001_create_tables.ts` | Refactored to export `up()` in the runner's module format (kept for fresh installs; 002 supersedes its tables). |
| `packages/clickhouse/package.json` | Add `"migrate": "tsx src/migrations/run.ts"`. |
| `packages/clickhouse/src/types.ts` | `VideoMetric` gains `metric_source`; new `VideoSnapshot` type. |
| `packages/clickhouse/src/queries.ts` | Add `insertVideoSnapshots(rows)`, `queryLatestSnapshots({ videoIds, beforeDate })` (single `argMax … GROUP BY video_id, platform` query). Audit existing 8 read fns — `video_daily_stats` readers work via the view; any direct `video_metrics` read gains `FINAL`. |

## 4. Acceptance Criteria

- [ ] `pnpm --filter @kit/clickhouse migrate` applies pending migrations in order and is a no-op on re-run
- [ ] Double-inserting the same (video, platform, day) row yields exactly one row under `SELECT … FINAL`, with the latest values
- [ ] All 8 existing query functions return correct results against the compatibility view
- [ ] `queryLatestSnapshots` returns the latest snapshot strictly before the given date per video
- [ ] No package reads `video_metrics` expecting multiple rows per day (grep verified before merge)
- [ ] `DROP TABLE video_daily_stats` removes the old MV's implicit storage (no `.inner.*` remnants)

## 5. Verification

```bash
pnpm --filter @kit/clickhouse migrate     # against local Docker ClickHouse
pnpm --filter @kit/clickhouse test
```

Manual: insert a fixture (video, day) twice with different values → `SELECT * FROM video_daily_stats WHERE video_id = …` shows one row with the second values.
