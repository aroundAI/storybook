/**
 * Channel dimension on video_dim (FILM-1602).
 *
 * A project spans several channels — different platforms, and separate
 * per-language YouTube channels where multi-language audio is unavailable.
 * Without connection_id on the dimension table no deep-dive metric can be
 * grouped or filtered by channel, and YPP watch hours pool across channels
 * against a single target even though the gate is per-channel.
 *
 * Cheap: connection_id is not part of `ORDER BY (video_id)`, so this is a
 * metadata-only change with no re-sort and no partition rewrite.
 *
 * Backfill is the existing reconcile — `upsertVideoDims()` with no argument
 * re-upserts every published row and ReplacingMergeTree keeps the newest by
 * updated_at, so no separate backfill script is needed. It runs nightly, and
 * on demand via `POST /api/analytics/backfill`, which already calls it.
 *
 * That only holds because the reconcile pages its reads. It previously did
 * not, and PostgREST caps an unbounded select at `max_rows` (1000) with no
 * error — so it silently re-upserted the same first page and backfilled
 * nothing beyond it. Keep `upsertVideoDims` paginated.
 *
 * Deploy the migration BEFORE the app. Inserts from the new code carry
 * `connection_id`, and against a table still missing the column ClickHouse
 * either rejects the batch or drops the field, depending on
 * `input_format_skip_unknown_fields` — which this project does not set.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_dim ADD COLUMN IF NOT EXISTS connection_id UUID`,
];

export const migration: ClickHouseMigration = {
  name: '007_video_dim_connection',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
