/**
 * Not measured is NULL, not 0 (KB-111).
 *
 * TikTok and Instagram report none of `avg_view_duration_seconds`,
 * `avg_view_percentage`, `dislikes` or `subscribers_lost` on any surface we
 * ingest. The columns were `DEFAULT 0` (migrations 004 and 006), so their rows
 * stored 0, and every reader took it as a measurement: a TikTok video pooled
 * with a YouTube one turned an average percentage viewed of 45.5% into a
 * "measured" 13%. YouTube measures all four, and both of its writers must
 * keep sending them (`YouTubeVideoMetric`, KB-94).
 *
 * Every step below was measured on ClickHouse 24.8.14.39 first:
 *
 * 1. `MODIFY COLUMN … Nullable(…)` keeps the old `DEFAULT 0`, so an omitted
 *    field would still store 0. Hence the separate `REMOVE DEFAULT`.
 * 2. `video_daily_stats` is a plain VIEW, and it keeps the column types it was
 *    created with. Once a single NULL exists, **every read through it fails**
 *    (Code 349, CANNOT_INSERT_NULL_IN_ORDINARY_COLUMN). It is recreated here,
 *    as 004 and 006 did, and **before** any NULL is written.
 * 3. Existing TikTok and Instagram rows are set to NULL last. No source ever
 *    measured those values, so nothing measured is lost.
 * 4. The cost at 2,000,000 rows was 0.13 s for (1) and 0.17 s for (3).
 *
 * Deploy BEFORE the app. On the old schema the new app's explicit nulls are
 * not rejected: `input_format_null_as_default` turns them into 0 (measured),
 * which is today's behaviour. So the order only decides whether a few rows are
 * written as 0 first.
 *
 * ROLLBACK IS TWO STEPS, NEVER ONE. A plain `MODIFY COLUMN … Float32 DEFAULT 0`
 * with NULLs present fails part-way, and it leaves a stuck mutation that
 * breaks ordinary SELECTs on `video_metrics` until `KILL MUTATION` (measured).
 * Instead:
 *   ALTER TABLE video_metrics UPDATE <col> = ifNull(<col>, 0)
 *     WHERE <col> IS NULL SETTINGS mutations_sync = 2;       -- each column
 *   ALTER TABLE video_metrics MODIFY COLUMN <col> <Type> DEFAULT 0;
 *   then recreate video_daily_stats as below.
 */
import type { ClickHouseMigration } from './migration-types';

const COLUMNS = [
  ['avg_view_duration_seconds', 'Float32'],
  ['avg_view_percentage', 'Float32'],
  ['dislikes', 'UInt32'],
  ['subscribers_lost', 'UInt32'],
] as const;

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ${COLUMNS.map(([name, type]) => `MODIFY COLUMN ${name} Nullable(${type})`).join(',\n    ')}`,
  `ALTER TABLE video_metrics
    ${COLUMNS.map(([name]) => `MODIFY COLUMN ${name} REMOVE DEFAULT`).join(',\n    ')}`,
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
  `ALTER TABLE video_metrics
    UPDATE ${COLUMNS.map(([name]) => `${name} = NULL`).join(', ')}
    WHERE platform IN ('tiktok', 'instagram')
    SETTINGS mutations_sync = 2`,
];

export const migration: ClickHouseMigration = {
  name: '013_unmeasured_is_null',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
