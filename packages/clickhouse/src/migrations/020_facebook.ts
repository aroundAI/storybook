/**
 * Facebook joins the analytics tables (FILM-1720).
 *
 * 1. `platform` gains `'facebook' = 4` on the six tables that carry the
 *    enum: video_metrics, video_snapshots (002), video_reach_daily,
 *    video_traffic_sources (003), video_retention_curves and video_audience
 *    (004). 001's video_metrics was dropped by 002, and channel_windows has
 *    had the value since 016. **Appended, never renumbered**: an appended
 *    value is a metadata change, a renumbered one rewrites every row.
 *    `PLATFORM_ENUM_VALUES` in `lib/platform-enum.ts` must match, and
 *    `platform-enum.test.ts` says so.
 *
 * 2. `views` becomes Nullable on video_metrics and video_snapshots. Facebook
 *    has four kinds of view and none of them is a view in the sense the
 *    other three platforms' `views` is (FILM-1722: no single view
 *    definition). A Facebook row writes NULL there — cannot measure — so no
 *    pooled views figure ever adds a Facebook denominator to a YouTube view.
 *    Owner-approved option A, 2026-10-01.
 *
 * 3. Facebook's own denominators get their own columns, nullable, on both
 *    tables: the snapshot holds the lifetime figure, video_metrics the day's
 *    increase. Every other platform leaves them NULL.
 *
 *    | column                     | Graph metric                          |
 *    |----------------------------|---------------------------------------|
 *    | media_views                | post_media_view (played or displayed) |
 *    | plays                      | blue_reels_play_count (>=1ms, no replays) |
 *    | replays                    | fb_reels_replay_count                 |
 *    | views_3s                   | total_video_views                     |
 *    | views_3s_organic           | total_video_views_organic             |
 *    | views_3s_paid              | total_video_views_paid                |
 *    | views_3s_autoplayed        | total_video_views_autoplayed          |
 *    | views_3s_clicked_to_play   | total_video_views_clicked_to_play     |
 *    | views_15s                  | total_video_15s_views (not ThruPlay)  |
 *    | complete_views             | total_video_complete_views (>=97%)    |
 *
 * `video_daily_stats` is a plain VIEW that keeps its creation-time types and
 * fails every read with Code 349 once a NULL exists in a column it typed as
 * non-null (013), so it is recreated straight after the MODIFY and before
 * any NULL can be written. No row is mutated: every existing row has views.
 *
 * Deploy BEFORE the app, which writes the new columns and the NULLs.
 *
 * ROLLBACK, in this order (two steps for views, as 013 measured):
 *   roll the app back;
 *   ALTER TABLE video_metrics DELETE WHERE platform = 'facebook'
 *     SETTINGS mutations_sync = 2;              -- and video_snapshots
 *   ALTER TABLE video_metrics MODIFY COLUMN views UInt64;   -- and snapshots
 *   ALTER TABLE <each> DROP COLUMN IF EXISTS <each new column>;
 *   recreate video_daily_stats as below. The enum value can stay.
 */
import type { ClickHouseMigration } from './migration-types';

const PLATFORM_ENUM =
  "Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3, 'facebook' = 4)";

const ENUM_TABLES = [
  'video_metrics',
  'video_snapshots',
  'video_reach_daily',
  'video_traffic_sources',
  'video_retention_curves',
  'video_audience',
] as const;

const DENOMINATOR_COLUMNS = [
  'media_views',
  'plays',
  'replays',
  'views_3s',
  'views_3s_organic',
  'views_3s_paid',
  'views_3s_autoplayed',
  'views_3s_clicked_to_play',
  'views_15s',
  'complete_views',
] as const;

const COUNTER_TABLES = ['video_metrics', 'video_snapshots'] as const;

const STATEMENTS = [
  ...ENUM_TABLES.map(
    (table) => `ALTER TABLE ${table} MODIFY COLUMN platform ${PLATFORM_ENUM}`,
  ),
  ...COUNTER_TABLES.map(
    (table) => `ALTER TABLE ${table}
    MODIFY COLUMN views Nullable(UInt64),
    ${DENOMINATOR_COLUMNS.map((name) => `ADD COLUMN IF NOT EXISTS ${name} Nullable(UInt64)`).join(',\n    ')}`,
  ),
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
  name: '020_facebook',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};

/** For `platform-enum.test.ts`: the enum this migration leaves on every table. */
export const PLATFORM_ENUM_AFTER_020 = PLATFORM_ENUM;
