/**
 * Unique accounts reached per channel, per window (cross-platform reach
 * design, approved 2026-09-28).
 *
 * Unique counts do not add up across days, so a 7- or 30-day figure cannot
 * be built from daily rows: it has to be the platform's own answer for that
 * window, recorded on the day it is offered. Meta keeps about 90 days of
 * account insights, so one row per channel, window and day, kept with no
 * TTL, is what lets a year-old growth curve exist at all.
 *
 * Reach only. Views, comments and shares add up across days and already live
 * in `video_metrics` and `channel_daily`; a second copy here would let the
 * two disagree.
 *
 * - `window_days`: 7 or 30 for Instagram (Meta caps a unique window at 30
 *   days, so there is no 90-day figure), plus 23 — the 23 days ending 7 days
 *   earlier — from which the 7-day card derives "new in the last 7 days"
 *   (30-day reach minus it).
 * - `accounts_reached_followers` / `_non_followers`: Meta's `follow_type`
 *   split of the same reach. NULL when not asked for or not returned; they
 *   need not sum to the total (Meta also answers UNKNOWN).
 * - `as_of`: the last complete day in the window.
 * - `inserted_at` is DateTime64(3) for migration 008's reason: it is the
 *   version, and two writes inside one second would tie.
 *
 * Nothing here is ever summed across rows — not across days, windows,
 * channels or platforms.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS channel_windows (
    connection_id UUID,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3, 'facebook' = 4),
    as_of Date,
    window_days UInt16,
    accounts_reached Nullable(UInt64),
    accounts_reached_followers Nullable(UInt64),
    accounts_reached_non_followers Nullable(UInt64),
    source LowCardinality(String),
    inserted_at DateTime64(3) DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(inserted_at)
  PARTITION BY toYYYYMM(as_of)
  ORDER BY (connection_id, platform, window_days, as_of)`,
];

export const migration: ClickHouseMigration = {
  name: '016_channel_windows',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
