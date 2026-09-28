/**
 * Instagram accounts reached per post (FILM-1712 part B).
 *
 * Meta's media `reach` is "the number of unique accounts that have seen" a
 * post, lifetime, tagged estimated. It was requested and then dropped into
 * `extra_metrics` as text, 0 when missing. It now gets a column on both
 * tables the snapshot-delta ingest uses:
 *
 * - `video_snapshots.accounts_reached`: the lifetime figure, the next day's
 *   baseline and the source of a post's lifetime reach.
 * - `video_metrics.accounts_reached`: the day's increase — accounts that saw
 *   the post for the first time that day. NULL when not measured: every
 *   YouTube and TikTok row, a missing value, and the first day after this
 *   ships (old snapshots have no reach to subtract from).
 *
 * Named for what it counts, not `reach`: `video_reach_daily` and the 'reach'
 * metric family already mean YouTube impressions and CTR.
 *
 * Unique counts do not add up across posts: read it one post at a time
 * (`queryAccountsReached`). Additive only — no mutation, no type change —
 * so `video_daily_stats`, which names its columns, is untouched, and the
 * running app is unaffected. Deploy BEFORE the app, which writes the column.
 *
 * Rollback: roll the app back first, then
 *   ALTER TABLE video_metrics DROP COLUMN IF EXISTS accounts_reached;
 *   ALTER TABLE video_snapshots DROP COLUMN IF EXISTS accounts_reached;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_metrics
    ADD COLUMN IF NOT EXISTS accounts_reached Nullable(UInt64)`,
  `ALTER TABLE video_snapshots
    ADD COLUMN IF NOT EXISTS accounts_reached Nullable(UInt64)`,
];

export const migration: ClickHouseMigration = {
  name: '015_accounts_reached',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
