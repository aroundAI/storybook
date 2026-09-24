/**
 * Engaged views per video per day (KB-50).
 *
 * YouTube redefined `views` on 2026-08-27 to count from the moment playback
 * begins, autoplay included. `engagedViews` keeps the earlier methodology,
 * so it is the series that stays continuous across that date (FILM-1722,
 * FILM-1713). `channel_basic_a3` carries it and was parsed, then dropped.
 *
 * Nullable, with no default. NULL means YouTube did not report the figure:
 * a day before the metric existed (2025-04-24), a report version without the
 * column, a failed query, or a platform that has no such thing. A `DEFAULT 0`
 * would be a default read as a measurement.
 *
 * Both `video_metrics` writers fill it: the Reporting ingest from the CSV,
 * and the Analytics-API sync and backfill from the `engagedViews` metric.
 * That is not optional. They write the same ReplacingMergeTree key, and the
 * later row replaces the whole row, so a column only one of them filled
 * reads NULL after the other's next write — measured before this migration,
 * and asserted in `verify-queries.ts`.
 *
 * `video_daily_stats` is not recreated: nothing reads the column yet.
 *
 * Deploy BEFORE the app. Until then the client skips the unknown field on
 * insert, so the order only decides whether the first rows carry a value.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS engaged_views Nullable(UInt64)`,
];

export const migration: ClickHouseMigration = {
  name: '012_video_metrics_engaged_views',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
