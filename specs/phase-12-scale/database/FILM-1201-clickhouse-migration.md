---
spec_id: FILM-1201
title: ClickHouse Analytics Migration
status: Draft
effort: L
dependencies: FILM-804, FILM-805
---

# ClickHouse Analytics Migration

## 1. Overview

This specification details the architectural migration from a Supabase-based (Postgres) analytics system to a pure ClickHouse-based strategy. The goal is to improve query performance, scalability, and enable real-time aggregation of high-volume analytics data (views, likes, watch time) without burdening the primary transactional database.

## 2. Architecture Changes

### Current Architecture (Supabase/Postgres)
- **Ingestion**: `analytics-sync-cron.ts` fetches data from platforms and upserts directly into the `content_analytics` table in Postgres.
- **Storage**: Row-based storage in Postgres (`content_analytics`).
- **Querying**: `aggregation-queries.ts` performs complex sums and aggregations directly on the Postgres table.
- **Scalability Limit**: As rows grow into millions, `SUM()` operations on Postgres become slow and resource-intensive.

### New Architecture (Pure ClickHouse)
- **Ingestion**: `analytics-sync-cron.ts` fetches data and inserts immutable logs into the `video_metrics` table in ClickHouse.
- **Storage**: Columnar storage in ClickHouse (`video_metrics`) with a Materialized View (`video_daily_stats`) for pre-aggregation.
- **Querying**: Application code (Next.js) fetches project/episode metadata from Supabase, then queries ClickHouse for the aggregated metrics using the IDs.
- **Benefits**: Sub-second queries on billions of rows; isolation of analytical load from transactional DB.

## 3. Database Schema (ClickHouse)

### 3.1 Raw Metrics Table (`video_metrics`)
This table acts as an immutable log of all data points received from API providers.

```sql
CREATE TABLE video_metrics (
    project_id UUID,
    video_id String, -- Maps to publish_id or platform_content_id
    platform Enum('youtube', 'tiktok', 'instagram'),
    metric_date Date,
    metric_timestamp DateTime DEFAULT now(),
    views UInt64,
    likes UInt32,
    comments UInt32,
    shares UInt32,
    saves UInt32,
    watch_time_seconds UInt64,
    revenue_cents Int64,
    subscribers_gained Int32,
    extra_metrics String -- JSON string for platform-specific raw data
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_timestamp);
```

### 3.2 Aggregated Materialized View (`video_daily_stats`)
This view pre-calculates daily totals, collapsing multiple updates into a single row per video per day. This is the primary target for read queries.

```sql
CREATE MATERIALIZED VIEW video_daily_stats
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_date)
AS SELECT
    project_id,
    video_id,
    platform,
    metric_date,
    sum(views) as views,
    sum(likes) as likes,
    sum(comments) as comments,
    sum(shares) as shares,
    sum(saves) as saves,
    sum(watch_time_seconds) as watch_time_seconds,
    sum(revenue_cents) as revenue_cents,
    sum(subscribers_gained) as subscribers_gained
FROM video_metrics
GROUP BY project_id, video_id, platform, metric_date;
```

## 4. Implementation Steps

### 4.1 Infrastructure Setup (`packages/clickhouse`)
1. Create a new package `@kit/clickhouse`.
2. Configure `clickhouse` client (singleton) using `@clickhouse/client`.
3. Define environment variables: `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`.

### 4.2 Ingestion Refactoring (`analytics-sync-cron.ts`)
1. **Stop Writing to Postgres**: Remove calls to `upsertContentAnalytics`.
2. **Direct Insert**: Update the sync job to insert fetched data directly into `video_metrics`.
3. **Data Mapping**: Ensure ID consistency. The `video_id` in ClickHouse must match the `publish_id` or `platform_content_id` stored in Supabase for joining later. Ideally use `publish_id` (UUID) if available during sync, or `platform_content_id` if that's what we get from the API.
   - *Recommendation*: Use `publish_id` (UUID) as `video_id` for cleaner joining with local tables.

### 4.3 Query Layer Refactoring
Refactor the following files to switch from Postgres-based queries to ClickHouse-based queries.

**Pattern**:
1. Fetch Metadata from Supabase: `SELECT id FROM seasons WHERE project_id = ?`.
2. Extract IDs: `const seasonIds = data.map(s => s.id)`.
3. Query ClickHouse: `SELECT sum(views) FROM video_daily_stats WHERE video_id IN (seasonIds)`.

**Files to Update**:
- `packages/features/content-analytics/src/server/aggregation-queries.ts` (Project, Season, Episode stats)
- `packages/features/content-analytics/src/server/language-analytics.ts` (Language breakdown)
- `packages/features/content-analytics/src/server/revenue-actions.ts` (Revenue summaries)

### 4.4 Migration Utility
Create a script to migrate existing historical data from Postgres to ClickHouse.
1. `SELECT * FROM content_analytics`
2. Transform rows to `video_metrics` format.
3. `INSERT INTO video_metrics` in batches.

## 5. Deprecation
Once verified:
1. Drop `content_analytics` table from Postgres.
2. Remove any remaining Typescript interfaces related to the Postgres analytics table.

## 6. Access Control & Security
- ClickHouse runs in a private subnet or is secured via TLS/Password.
- Only the API server (Next.js backend) has access credentials.
- Multi-tenancy is enforced by always filtering by `project_id` in queries.
