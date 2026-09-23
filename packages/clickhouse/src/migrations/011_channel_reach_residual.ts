/**
 * Reach residual in its own table (FILM-1504).
 *
 * `channel_daily` held the channel residual — videos that matched no publish
 * — from two independently delivered reports: `channel_basic_a3` (views,
 * watch time, subscribers) and `channel_reach_*_a1` (impressions). Each
 * wrote a whole row with the other report's columns zeroed, on one
 * `(connection_id, metric_date)` key, and ReplacingMergeTree keeps only the
 * later row. Whichever report landed second erased the first: a reach report
 * arriving after the basic one read YPP watch time and residual subscriber
 * movement back as 0. Migration 003 had already stated the rule this broke —
 * "a partial row would clobber the full metrics row" — and applied it at the
 * per-video grain only.
 *
 * So the reach residual moves here, beside `video_reach_daily`, and each
 * table is written by exactly one report family.
 *
 * Two columns go, because neither can ever hold a measurement:
 *
 * - `channel_daily.impressions` — no writer after this change, so every
 *   value would be a default read as "no impressions".
 * - `video_reach_daily.engaged_views` — neither reach report carries the
 *   column (Google's channel report reference); the parser read it anyway
 *   and stored 0 for every row.
 *
 * `inserted_at` is `DateTime64(3)` for 008's reason: it is the version, and
 * at second resolution two writes inside one second tie.
 *
 * Deploy BEFORE the app. The old app still sends both dropped fields
 * (ignored as unknown JSON on insert), but its quality query selects
 * `engaged_views` and would fail against the new table. Production has no
 * ClickHouse yet (`CLICKHOUSE_ENABLED` unset), so this first runs at the
 * FILM-1503 cutover against empty tables.
 *
 * Existing reach-shaped rows in a dev `channel_daily` (all-zero once
 * `impressions` is gone) are not repaired here: re-seed, or re-ingest.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS channel_reach_daily (
    connection_id UUID,
    metric_date Date,
    impressions UInt64,
    impressions_ctr Float32,
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(metric_date)
  ORDER BY (connection_id, metric_date)`,
  `ALTER TABLE channel_daily DROP COLUMN IF EXISTS impressions`,
  `ALTER TABLE video_reach_daily DROP COLUMN IF EXISTS engaged_views`,
];

export const migration: ClickHouseMigration = {
  name: '011_channel_reach_residual',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
