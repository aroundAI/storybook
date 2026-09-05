/**
 * Absolute subscriber snapshots (FILM-1607).
 *
 * Every subscriber figure this codebase held before now was a delta —
 * `subscribers_gained`/`subscribers_lost` on `video_metrics` and
 * `channel_daily`. Deltas give a curve its shape but never its height, so
 * the level was undrawable. This table stores the anchor.
 *
 * A separate table rather than a column on `channel_daily`, which is the
 * residual of videos that failed to match a publish: its rows exist only
 * where there was unmatched activity, so a channel with every video matched
 * would have no row to carry its level. The two answer different questions.
 *
 * `rounding_step` is a granularity, not a boolean. YouTube rounds the public
 * subscriber count to three significant figures above 1,000 — for the channel
 * owner too — so an anchor is often a band rather than a point, and the
 * reader needs the band's width to know whether a delta-derived level
 * contradicts it. Storing the step fixes that arithmetic once, at capture,
 * where the platform and magnitude are both known. `0` means exact.
 *
 * `inserted_at` is `DateTime64(3)`, unlike the second-resolution `DateTime`
 * on the older tables here, because it doubles as the ReplacingMergeTree
 * version and the capture promises last-write-wins for a given
 * (connection_id, snapshot_date). At second resolution two inserts inside one
 * second carry equal versions and the survivor is undefined.
 *
 * Additive, and no backfill: no API returns a historical absolute count. Days
 * between the cutover and the first snapshot are recoverable by walking the
 * exact deltas backwards from that snapshot; days before the cutover are not,
 * because no delta exists for them.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS channel_subscribers (
    connection_id UUID,
    snapshot_date Date,
    subscriber_count UInt64,
    rounding_step UInt32 DEFAULT 0,
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(snapshot_date)
  ORDER BY (connection_id, snapshot_date)`,
];

export const migration: ClickHouseMigration = {
  name: '008_channel_subscribers',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
