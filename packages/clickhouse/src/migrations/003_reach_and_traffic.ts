/**
 * Reach, traffic-source, and channel-rollup tables (FILM-1504).
 *
 * - video_reach_daily: thumbnail impressions + CTR + engaged views per
 *   video/day, from the YouTube Reporting API reach reports. A separate
 *   table (not columns on video_metrics) because reach CSVs arrive
 *   independently — a partial row would clobber the full metrics row
 *   under ReplacingMergeTree.
 * - video_traffic_sources: per video/day/source views + watch time
 *   (YouTube Reporting API; also populated from the Analytics API payload
 *   in FILM-1505 for lifetime data and other platforms).
 * - channel_daily: rollup for channel videos NOT published through the
 *   platform, keyed by connection. Keeps channel-wide numbers — the YPP
 *   watch-hours gate above all — accurate.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS video_reach_daily (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,
    impressions UInt64,
    impressions_ctr Float32,
    engaged_views UInt64,
    inserted_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (project_id, platform, video_id, metric_date)`,
  `CREATE TABLE IF NOT EXISTS video_traffic_sources (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,
    source LowCardinality(String),
    views UInt64,
    watch_time_minutes Float32,
    inserted_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (project_id, platform, video_id, metric_date, source)`,
  `CREATE TABLE IF NOT EXISTS channel_daily (
    connection_id UUID,
    metric_date Date,
    views UInt64,
    watch_time_seconds UInt64,
    impressions UInt64,
    engaged_views UInt64,
    inserted_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (connection_id, metric_date)`,
];

export const migration: ClickHouseMigration = {
  name: '003_reach_and_traffic',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
