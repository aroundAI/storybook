/**
 * Facebook's own average watch time per post (KB-212).
 *
 * Meta's averages were never requested, so a Facebook video had no average
 * view duration anywhere. Now the sync asks for `total_video_avg_time_watched`
 * (a video in the player) and `post_video_avg_time_watched` (a Reel: replay
 * time over first plays, so it can exceed the video's length), one per
 * publish, never the other as a fallback.
 *
 * - `fb_avg_watch_time_ms`: milliseconds, as Meta reports both (the
 *   capability reference's `facebook/video-insights` block). A lifetime
 *   quotient, like Instagram's `ig_reels_avg_watch_time_ms` (migration 023):
 *   it goes on `video_snapshots` only, never as a day's delta, and is never
 *   derived from watch time over views, which Facebook does not have.
 *
 * Float64, so a fractional value is stored as sent. NULL when not measured:
 * every other platform's row, a field Meta omitted, and every snapshot taken
 * before this ships.
 *
 * Additive only, with no SETTINGS clause (production refuses settings that
 * change server limits). Deploy BEFORE the app, which writes the column.
 *
 * Rollback: roll the app back first, then
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS fb_avg_watch_time_ms;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENT = `ALTER TABLE video_snapshots
    ADD COLUMN IF NOT EXISTS fb_avg_watch_time_ms Nullable(Float64)`;

export const migration: ClickHouseMigration = {
  name: '026_facebook_avg_watch_time',
  async up(client) {
    await client.command({ query: STATEMENT });
  },
};
