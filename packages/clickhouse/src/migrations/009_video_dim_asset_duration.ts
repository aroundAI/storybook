/**
 * The published asset's duration on video_dim (FILM-1710).
 *
 * `duration_seconds` held the *episode's* duration, falling back to its
 * target and then to zero, so a Short cut from a 22-minute episode read as
 * ~1,320 seconds. Two changes:
 *
 * - The existing column is renamed to `episode_duration_seconds`. It is not
 *   repurposed: a silent meaning change on a column named `duration_seconds`
 *   is what produced the defect, and a rename makes a stale reader fail
 *   loudly instead.
 * - `asset_duration_seconds` is added as `Nullable(UInt32)`. The old column
 *   is `UInt32`, where 0 and "unknown" are the same value; absence has to be
 *   representable because it is the state of every historical row.
 *
 * Neither column is part of `ORDER BY (video_id)` or the ReplacingMergeTree
 * version, so both statements are metadata-only.
 *
 * Backfill is the existing reconcile — `upsertVideoDims()` re-upserts every
 * published row — once `publishes.duration_seconds` has been filled by the
 * asset-duration sync.
 *
 * Deploy the migration BEFORE the app, as with 007: inserts from the new
 * code name both columns.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_dim RENAME COLUMN IF EXISTS duration_seconds TO episode_duration_seconds`,
  `ALTER TABLE video_dim ADD COLUMN IF NOT EXISTS asset_duration_seconds Nullable(UInt32)`,
];

export const migration: ClickHouseMigration = {
  name: '009_video_dim_asset_duration',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
