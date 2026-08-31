/**
 * Gross subscriber gained/lost (FILM-1601).
 *
 * The Reporting API returns `subscribers_gained` and `subscribers_lost`
 * separately, but the parser collapsed them into the column named
 * `subscribers_gained` — a field whose name says gross while it held net.
 * Both indices are already resolved during parsing, so keeping the split
 * costs nothing.
 *
 * SAFE WITHOUT BACKFILL: historical rows keep the net figure in
 * `subscribers_gained` with `subscribers_lost` defaulting to 0, so
 * `gained - lost` is correct for old and new rows alike. Only the gross
 * split is unavailable for history, which was never recorded and cannot be
 * recovered.
 *
 * channel_daily gains both columns so channel-wide subscriber movement from
 * videos that never matched a publish is no longer discarded.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS subscribers_lost UInt32 DEFAULT 0`,
  `ALTER TABLE channel_daily
    ADD COLUMN IF NOT EXISTS subscribers_gained UInt32 DEFAULT 0`,
  `ALTER TABLE channel_daily
    ADD COLUMN IF NOT EXISTS subscribers_lost UInt32 DEFAULT 0`,
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
    subscribers_lost,
    avg_view_duration_seconds,
    avg_view_percentage,
    dislikes
  FROM video_metrics FINAL`,
];

export const migration: ClickHouseMigration = {
  name: '006_gross_subscribers',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
