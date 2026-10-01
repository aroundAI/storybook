/**
 * Instagram's all-surface aggregates per post (FILM-1722).
 *
 * `total_views_count`, `total_like_count` and `total_comments_count` are
 * Media node fields Meta added on 2026-04-22. Each folds in boosted
 * placements, and the views one replays too, so they are not `views`,
 * `likes` or `comments` and get columns of their own, named so nothing reads
 * them as those (`INSTAGRAM_AGGREGATES` in lib/view-definitions.ts). Counters,
 * so the same two columns each as reposts (migration 018):
 *
 * - `video_snapshots.all_surface_*`: the lifetime figure and the next day's
 *   baseline.
 * - `video_metrics.all_surface_*`: the day's increase. NULL when not
 *   measured: every YouTube and TikTok row, a Story, a field Meta omitted,
 *   and the first day after this ships.
 *
 * UInt64, not UInt32: a views total across every surface is the largest
 * counter we store per post.
 *
 * Additive only, so `video_daily_stats`, which names its columns, is
 * untouched. Deploy BEFORE the app, which writes the columns.
 *
 * Rollback: roll the app back first, then for each of video_metrics and
 * video_snapshots:
 *   ALTER TABLE <table> DROP COLUMN IF EXISTS all_surface_views;
 *   ALTER TABLE <table> DROP COLUMN IF EXISTS all_surface_likes;
 *   ALTER TABLE <table> DROP COLUMN IF EXISTS all_surface_comments;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = ['video_metrics', 'video_snapshots'].map(
  (table) => `ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS all_surface_views Nullable(UInt64),
    ADD COLUMN IF NOT EXISTS all_surface_likes Nullable(UInt64),
    ADD COLUMN IF NOT EXISTS all_surface_comments Nullable(UInt64)`,
);

export const migration: ClickHouseMigration = {
  name: '019_all_surface_aggregates',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
