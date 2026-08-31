/**
 * ClickHouse v2 data model (FILM-1501).
 *
 * Replaces the v1 append+sum model with an idempotent true-daily model:
 * - video_metrics: one row per (video, platform, day) holding TRUE DAILY
 *   values keyed by the platform data date. ReplacingMergeTree(inserted_at)
 *   means late, restated, or duplicate deliveries replace the row instead
 *   of corrupting sums.
 * - video_snapshots: latest lifetime cumulative totals per video/platform/day,
 *   the delta baseline for TikTok/Instagram (their APIs only expose lifetime
 *   counters).
 * - video_daily_stats becomes a plain VIEW over `video_metrics FINAL`, so
 *   existing readers in queries.ts keep working unchanged.
 *
 * DESTRUCTIVE: drops the v1 video_daily_stats materialized view and
 * video_metrics table. The v1 data is over-counted beyond repair (lifetime
 * totals summed per sync) and is re-populated via the FILM-1503 backfill.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `DROP TABLE IF EXISTS video_daily_stats`,
  `DROP TABLE IF EXISTS video_metrics`,
  `CREATE TABLE IF NOT EXISTS video_metrics (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,
    views UInt64,
    likes UInt32,
    comments UInt32,
    shares UInt32,
    saves UInt32,
    watch_time_seconds UInt64,
    revenue_cents Int64,
    subscribers_gained Int32,
    metric_source Enum('analytics_api' = 1, 'reporting_api' = 2, 'snapshot_delta' = 3, 'backfill' = 4) DEFAULT 'analytics_api',
    inserted_at DateTime DEFAULT now(),
    extra_metrics String DEFAULT '{}'
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (project_id, platform, video_id, metric_date)
  SETTINGS index_granularity = 8192`,
  `CREATE TABLE IF NOT EXISTS video_snapshots (
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
  ORDER BY (project_id, platform, video_id, snapshot_date)`,
  `CREATE VIEW IF NOT EXISTS video_daily_stats AS
  SELECT
    project_id,
    video_id,
    platform,
    metric_date,
    views,
    likes,
    comments,
    shares,
    saves,
    watch_time_seconds,
    revenue_cents,
    subscribers_gained
  FROM video_metrics FINAL`,
];

export const migration: ClickHouseMigration = {
  name: '002_metrics_v2',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
