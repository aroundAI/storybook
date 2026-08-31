/**
 * Extended metrics: retention curves, audience breakdowns, and per-day
 * quality columns (FILM-1505).
 *
 * - video_metrics gains per-day columns: avg_view_duration_seconds,
 *   avg_view_percentage, dislikes. Only semantically-daily values become
 *   columns — window/lifetime aggregates (subscribed status, demographics,
 *   geography, devices) live in video_audience where latest-wins semantics
 *   are correct, and the ad/premium revenue split lives in revenue_records
 *   (FILM-1508).
 * - video_retention_curves: lifetime audience retention curve per video,
 *   latest fetch wins per point.
 * - video_audience: latest-wins breakdown rows keyed by dimension
 *   (age_gender | gender | country | city | device | os | follower_status).
 * - video_daily_stats view is recreated to expose the new columns.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS avg_view_duration_seconds Float32 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS avg_view_percentage Float32 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dislikes UInt32 DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS video_retention_curves (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    elapsed_ratio Float32,
    audience_watch_ratio Float32,
    fetched_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(fetched_at)
  ORDER BY (project_id, platform, video_id, elapsed_ratio)`,
  `CREATE TABLE IF NOT EXISTS video_audience (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    dimension LowCardinality(String),
    key String,
    views UInt64,
    percentage Float32,
    fetched_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(fetched_at)
  ORDER BY (project_id, platform, video_id, dimension, key)`,
  `DROP TABLE IF EXISTS video_daily_stats`,
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
    subscribers_gained,
    avg_view_duration_seconds,
    avg_view_percentage,
    dislikes
  FROM video_metrics FINAL`,
];

export const migration: ClickHouseMigration = {
  name: '004_extended_metrics',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
