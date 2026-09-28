/**
 * Not measured is NULL, not 0, in the lifetime snapshots too (FILM-1712).
 * 014 did this for the daily rows (KB-114); the snapshot each daily delta is
 * computed from kept writing a literal 0:
 *
 * - TikTok: no saves, watch time or per-video follower gains on any surface
 *   we can authorise.
 * - Instagram: Reels watch time and follows are not stored (FILM-1712: the
 *   watch-time unit is unconfirmed; follows do not exist for Reels).
 * - YouTube: there is no saves metric.
 *
 * No view reads `video_snapshots`, so there is none to recreate. The NULLing
 * runs last, after the columns can hold it.
 *
 * Deploy BEFORE the app: the app writes NULL into these columns.
 *
 * ROLLBACK IS TWO STEPS, NEVER ONE (014's note: a one-step MODIFY with NULLs
 * present wedges the table until KILL MUTATION):
 *   ALTER TABLE video_snapshots UPDATE <col> = ifNull(<col>, 0)
 *     WHERE <col> IS NULL SETTINGS mutations_sync = 2;       -- each column
 *   ALTER TABLE video_snapshots MODIFY COLUMN <col> <Type>;
 */
import type { ClickHouseMigration } from './migration-types';

const COLUMNS = [
  ['saves', 'UInt32'],
  ['watch_time_seconds', 'UInt64'],
  ['subscribers_gained', 'Int32'],
] as const;

const STATEMENTS = [
  `ALTER TABLE video_snapshots
    ${COLUMNS.map(([name, type]) => `MODIFY COLUMN ${name} Nullable(${type})`).join(',\n    ')}`,
  `ALTER TABLE video_snapshots
    UPDATE saves = NULL, watch_time_seconds = NULL, subscribers_gained = NULL
    WHERE platform = 'tiktok'
    SETTINGS mutations_sync = 2`,
  `ALTER TABLE video_snapshots
    UPDATE watch_time_seconds = NULL, subscribers_gained = NULL
    WHERE platform = 'instagram'
    SETTINGS mutations_sync = 2`,
  `ALTER TABLE video_snapshots
    UPDATE saves = NULL
    WHERE platform = 'youtube'
    SETTINGS mutations_sync = 2`,
];

export const migration: ClickHouseMigration = {
  name: '017_snapshot_unmeasured_null',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
