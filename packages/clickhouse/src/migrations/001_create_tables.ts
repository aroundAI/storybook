/**
 * ClickHouse v1 schema: video_metrics table + video_daily_stats
 * materialized view.
 *
 * Kept for migration-history completeness on fresh installs; the tables it
 * creates are dropped and replaced by 002_metrics_v2. Uses IF NOT EXISTS so
 * re-running is safe.
 *
 * Run all pending migrations with: pnpm --filter @kit/clickhouse migrate
 */
import type { ClickHouseMigration } from './migration-types';

const CREATE_VIDEO_METRICS = `
CREATE TABLE IF NOT EXISTS video_metrics (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
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
    extra_metrics String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_timestamp)
SETTINGS index_granularity = 8192
`;

const CREATE_VIDEO_DAILY_STATS = `
CREATE MATERIALIZED VIEW IF NOT EXISTS video_daily_stats
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_date)
AS SELECT
    project_id,
    video_id,
    platform,
    metric_date,
    sum(views) AS views,
    sum(likes) AS likes,
    sum(comments) AS comments,
    sum(shares) AS shares,
    sum(saves) AS saves,
    sum(watch_time_seconds) AS watch_time_seconds,
    sum(revenue_cents) AS revenue_cents,
    sum(subscribers_gained) AS subscribers_gained
FROM video_metrics
GROUP BY project_id, video_id, platform, metric_date
`;

export const migration: ClickHouseMigration = {
  name: '001_create_tables',
  async up(client) {
    await client.command({ query: CREATE_VIDEO_METRICS });
    await client.command({ query: CREATE_VIDEO_DAILY_STATS });
  },
};
