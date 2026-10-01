/**
 * X joins the analytics tables (FILM-1727).
 *
 * 1. `platform` gains `'twitter' = 5` — X's value is `twitter`, the one every
 *    Postgres table already stores (FILM-1727 §4, lead-approved 2026-10-01) —
 *    on all seven tables that carry the enum: the six 020 widened and
 *    channel_windows (016), which X does not write but which must not be the
 *    one table that refuses the value. **Appended, never renumbered**, and
 *    `facebook` = 4 is kept: a MODIFY that left it out would drop it.
 *    `PLATFORM_ENUM_VALUES` in `lib/platform-enum.ts` must match.
 *
 *    The three tables without the enum need nothing: `video_dim.platform` is
 *    a `LowCardinality(String)` that already holds `twitter` rows copied from
 *    publishes (FILM-1716's format families read them), and `channel_daily`
 *    and `channel_subscribers` carry no platform column.
 *
 * 2. `shares` becomes Nullable on video_metrics and video_snapshots. X's
 *    pay-per-use posts lookup reports no shares — X's `shares` is an
 *    Enterprise metric, and reposts have their own column (018) — so an X row
 *    writes NULL: cannot measure, never a measured zero (owner-approved option
 *    A, 2026-10-01). Every existing row keeps its value; nothing is mutated.
 *
 * `video_daily_stats` keeps its creation-time types and fails every read with
 * Code 349 once a NULL exists in a column it typed as non-null (013), so it is
 * recreated straight after the MODIFY, with 020's column list, before any NULL
 * can be written.
 *
 * Deploy BEFORE the app, which writes `twitter` rows and NULL shares.
 *
 * ROLLBACK, in this order (two steps for shares, as 013 measured):
 *   roll the app back;
 *   ALTER TABLE video_metrics DELETE WHERE platform = 'twitter'
 *     SETTINGS mutations_sync = 2;              -- and every table below
 *   ALTER TABLE video_metrics MODIFY COLUMN shares UInt32;   -- and snapshots
 *   recreate video_daily_stats as below. The enum value can stay.
 */
import type { ClickHouseMigration } from './migration-types';

const PLATFORM_ENUM =
  "Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3, 'facebook' = 4, 'twitter' = 5)";

const ENUM_TABLES = [
  'video_metrics',
  'video_snapshots',
  'video_reach_daily',
  'video_traffic_sources',
  'video_retention_curves',
  'video_audience',
  'channel_windows',
] as const;

const STATEMENTS = [
  ...ENUM_TABLES.map(
    (table) => `ALTER TABLE ${table} MODIFY COLUMN platform ${PLATFORM_ENUM}`,
  ),
  `ALTER TABLE video_metrics MODIFY COLUMN shares Nullable(UInt32)`,
  `ALTER TABLE video_snapshots MODIFY COLUMN shares Nullable(UInt32)`,
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
  name: '021_twitter',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};

/** The enum this migration leaves on every table, for the enum binding test. */
export const PLATFORM_ENUM_AFTER_021 = PLATFORM_ENUM;
export const ENUM_TABLES_AFTER_021 = ENUM_TABLES;
