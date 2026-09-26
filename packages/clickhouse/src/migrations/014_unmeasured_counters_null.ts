/**
 * Not measured is NULL, not 0, for saves, watch time and follower gains
 * (KB-114). The same pattern as 013 (KB-111), for three more columns.
 *
 * - TikTok: saves have no creator-auth surface, watch time is Business API
 *   only, and there are no per-video follower gains. All three were stored
 *   as 0.
 * - Instagram: Reels watch time and follows are never requested
 *   (FILM-1712), so watch time and follower gains were stored as 0. Saves
 *   are measured.
 * - YouTube: there is no saves metric. It was stored as 0.
 *
 * The three columns were created by 002 with no DEFAULT, so there is none to
 * remove. As in 013, `video_daily_stats` (a plain VIEW that keeps its
 * creation-time types, and fails every read with Code 349 once a NULL
 * exists) is recreated **before** any NULL is written. The NULLing runs last.
 *
 * Deploy BEFORE the app, for the reason 013 gives.
 *
 * ROLLBACK IS TWO STEPS, NEVER ONE (measured for 013: a one-step MODIFY with
 * NULLs present wedges the table until KILL MUTATION):
 *   ALTER TABLE video_metrics UPDATE <col> = ifNull(<col>, 0)
 *     WHERE <col> IS NULL SETTINGS mutations_sync = 2;       -- each column
 *   ALTER TABLE video_metrics MODIFY COLUMN <col> <Type>;
 *   then recreate video_daily_stats as below.
 */
import type { ClickHouseMigration } from './migration-types';

const COLUMNS = [
  ['saves', 'UInt32'],
  ['watch_time_seconds', 'UInt64'],
  ['subscribers_gained', 'Int32'],
] as const;

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ${COLUMNS.map(([name, type]) => `MODIFY COLUMN ${name} Nullable(${type})`).join(',\n    ')}`,
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
    UPDATE saves = NULL, watch_time_seconds = NULL, subscribers_gained = NULL
    WHERE platform = 'tiktok'
    SETTINGS mutations_sync = 2`,
  `ALTER TABLE video_metrics
    UPDATE watch_time_seconds = NULL, subscribers_gained = NULL
    WHERE platform = 'instagram'
    SETTINGS mutations_sync = 2`,
  `ALTER TABLE video_metrics
    UPDATE saves = NULL
    WHERE platform = 'youtube'
    SETTINGS mutations_sync = 2`,
];

export const migration: ClickHouseMigration = {
  name: '014_unmeasured_counters_null',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
