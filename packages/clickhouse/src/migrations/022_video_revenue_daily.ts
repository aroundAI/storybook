/**
 * Revenue gets its own table, and "not measured" stops reading as $0
 * (FILM-1726).
 *
 * 1. `video_revenue_daily`: one row per (video, day) that a platform
 *    reported earnings for, in US dollars (KB-12: ClickHouse holds no other
 *    currency). **A missing row means not measured.** Only the Analytics-API
 *    sync writes it, and only for a connection holding YouTube's monetary
 *    scope.
 *
 *    Revenue gets its own table rather than a column on `video_metrics`, for
 *    the reason FILM-1504 gave reach one. Two writers share a YouTube
 *    `video_metrics` key, the Analytics-API sync and the Reporting ingest,
 *    and the later row replaces the other whole (ReplacingMergeTree on
 *    `inserted_at`, KB-94). The Reporting API carries no revenue. On a
 *    shared row, a day's earnings would come and go depending on which
 *    writer ran last.
 *
 *    ReplacingMergeTree, ordered like `video_metrics`. A re-sync of the same
 *    day replaces the row instead of adding a second one, and every read
 *    uses FINAL. `verify-queries.ts` inserts one day twice and checks that
 *    it is counted once.
 *
 * 2. `video_metrics.revenue_cents` becomes Nullable and is set to NULL on
 *    every row. Each value there is a literal 0 that measured nothing:
 *    `revenue-writers.test.ts` (content-analytics) binds every writer of
 *    that column, and none has ever written anything but `0`. Nothing reads
 *    the column after this migration, and no writer sends it: an omitted
 *    Nullable column is NULL.
 *
 * 3. `video_daily_stats` takes `revenue_cents` from `video_revenue_daily`.
 *    The join's right side is Nullable, so a day with metrics and no
 *    revenue row reads NULL (join_use_nulls is off, so an unmatched row
 *    gets the column type's default, which is NULL for a Nullable). Every
 *    existing reader of the view then keeps "not measured" apart from 0
 *    without a change to its query. The column list is 020's, which 021
 *    (FILM-1727, X) keeps unchanged, so this assumes 021 has run first. The
 *    view is recreated before any NULL is written, for 013's reason: a
 *    plain VIEW keeps its creation-time types and fails every read with
 *    Code 349 once a NULL exists in a column it typed as non-null.
 *
 * Deploy BEFORE the app, which writes revenue rows and NULL revenue_cents.
 *
 * ROLLBACK, in this order (two steps for the column, as 013 measured):
 *   roll the app back;
 *   recreate video_daily_stats from 020's text (revenue_cents from
 *     video_metrics);
 *   ALTER TABLE video_metrics UPDATE revenue_cents = 0
 *     WHERE revenue_cents IS NULL SETTINGS mutations_sync = 2;
 *   ALTER TABLE video_metrics MODIFY COLUMN revenue_cents Int64;
 *   DROP TABLE video_revenue_daily — which loses measured earnings: export
 *     it first. Postgres revenue_records holds the same figures as totals.
 */
import { PLATFORM_ENUM_TYPE } from '../lib/platform-enum';
import type { ClickHouseMigration } from './migration-types';

/** The view's text, exported so `verify-queries.ts` can drop the dedup. */
export const VIDEO_DAILY_STATS_AFTER_022 = `CREATE VIEW IF NOT EXISTS video_daily_stats AS
  SELECT
    m.project_id AS project_id,
    m.video_id AS video_id,
    m.platform AS platform,
    m.metric_date AS metric_date,
    m.views AS views,
    m.likes AS likes,
    m.comments AS comments,
    m.shares AS shares,
    m.saves AS saves,
    m.watch_time_seconds AS watch_time_seconds,
    r.measured_revenue_cents AS revenue_cents,
    m.subscribers_gained AS subscribers_gained,
    m.subscribers_lost AS subscribers_lost,
    m.avg_view_duration_seconds AS avg_view_duration_seconds,
    m.avg_view_percentage AS avg_view_percentage,
    m.dislikes AS dislikes
  FROM (SELECT * FROM video_metrics FINAL) AS m
  LEFT JOIN (
    SELECT
      project_id,
      video_id,
      platform,
      metric_date,
      toNullable(revenue_cents) AS measured_revenue_cents
    FROM video_revenue_daily FINAL
  ) AS r
    ON m.project_id = r.project_id
    AND m.platform = r.platform
    AND m.video_id = r.video_id
    AND m.metric_date = r.metric_date`;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS video_revenue_daily (
    project_id UUID,
    video_id String,
    platform ${PLATFORM_ENUM_TYPE},
    metric_date Date,
    revenue_cents Int64,
    inserted_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (project_id, platform, video_id, metric_date)
  SETTINGS index_granularity = 8192`,
  `ALTER TABLE video_metrics MODIFY COLUMN revenue_cents Nullable(Int64)`,
  `DROP TABLE IF EXISTS video_daily_stats`,
  VIDEO_DAILY_STATS_AFTER_022,
  `ALTER TABLE video_metrics
    UPDATE revenue_cents = NULL
    WHERE revenue_cents IS NOT NULL
    SETTINGS mutations_sync = 2`,
];

export const migration: ClickHouseMigration = {
  name: '022_video_revenue_daily',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
