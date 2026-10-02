/**
 * Instagram's Reels attention figures per post (KB-151).
 *
 * `ig_reels_avg_watch_time` was requested since FILM-1712 and then dropped,
 * and `reels_skip_rate` was never requested. Meta documents both for REELS
 * only (media insights reference, read 2026-10-01). Each is a lifetime figure
 * Meta computes itself, so neither is a counter and neither has a day's
 * delta: they go on `video_snapshots` only, as reported.
 *
 * - `ig_reels_avg_watch_time_ms`: milliseconds, confirmed on a live account
 *   2026-09-29 (FILM-1712). Not `avg_view_duration_seconds`: Meta divides by
 *   its own count, not by views (749,526 ms over 221 views read 6,194).
 * - `ig_reels_skip_rate`: "the percentage of views from people who skipped
 *   during the first 3 seconds", tagged estimated and in development. Meta
 *   does not say 0–100 or 0–1, so it is stored unscaled.
 *
 * Float64 for both, so a fractional value is stored as sent rather than
 * refused or truncated. NULL when not measured: every YouTube and TikTok
 * row, a post that is not a Reel, a field Meta omitted, and every snapshot
 * taken before this ships.
 *
 * Numbered 023: 020 (#504), 021 (FILM-1727) and 022 (FILM-1726) are taken
 * by open branches. The runner applies by name, so the gap is harmless.
 *
 * Additive only. Deploy BEFORE the app, which writes the columns.
 *
 * Rollback: roll the app back first, then
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS ig_reels_avg_watch_time_ms;
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS ig_reels_skip_rate;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENT = `ALTER TABLE video_snapshots
    ADD COLUMN IF NOT EXISTS ig_reels_avg_watch_time_ms Nullable(Float64),
    ADD COLUMN IF NOT EXISTS ig_reels_skip_rate Nullable(Float64)`;

export const migration: ClickHouseMigration = {
  name: '023_reels_attention',
  async up(client) {
    await client.command({ query: STATEMENT });
  },
};
