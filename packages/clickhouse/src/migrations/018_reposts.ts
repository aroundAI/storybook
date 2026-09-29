/**
 * Instagram reposts per post (FILM-1712).
 *
 * `reposts_count` is a Media node field, FEED and REELS, added by Meta on
 * 2026-04-22: "Number of times the media has been reposted", lifetime. It is
 * the first media-level transmission signal Instagram offers, and FILM-1714's
 * Transmission reads it per reach. A counter, so it takes the same two
 * columns as saves:
 *
 * - `video_snapshots.reposts`: the lifetime figure and the next day's baseline.
 * - `video_metrics.reposts`: the day's increase. NULL when not measured:
 *   every YouTube and TikTok row, a Story, a missing value, and the first day
 *   after this ships (old snapshots have no reposts to subtract from).
 *
 * Additive only — no mutation, no type change — so `video_daily_stats`, which
 * names its columns, is untouched, and the running app is unaffected. Deploy
 * BEFORE the app, which writes the column.
 *
 * Rollback: roll the app back first, then
 *   ALTER TABLE video_metrics DROP COLUMN IF EXISTS reposts;
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS reposts;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS reposts Nullable(UInt32)`,
  `ALTER TABLE video_snapshots
    ADD COLUMN IF NOT EXISTS reposts Nullable(UInt32)`,
];

export const migration: ClickHouseMigration = {
  name: '018_reposts',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
