/**
 * The channel's target language on video_dim (FILM-1702).
 *
 * `video_dim.language` is `publishes.language` — the language of the asset.
 * The Language tab was built on something else: the *channel's* target
 * language, reached through a Postgres join that ClickHouse could not see.
 * So the Language tab and every ClickHouse-backed surface answered
 * different questions under the same word, and could never be
 * cross-filtered. Both now live here, side by side.
 *
 * `LowCardinality(String)` with no DEFAULT, deliberately: the implicit
 * default is `''`, which is LANGUAGE_NOT_SET. Every row written before this
 * column existed therefore reads as "channel target not set" until the
 * reconcile rewrites it — and never as a language nobody chose.
 *
 * Cheap, like 007: not part of `ORDER BY (video_id)`, so metadata only.
 *
 * Backfill is the existing reconcile — `upsertVideoDims()` with no argument
 * re-upserts every published row (nightly, or `POST /api/analytics/backfill`).
 * The same pass rewrites `language` for publishes the Postgres migration
 * reclassified from the defaulted `'en'` to NULL, so run it after both.
 *
 * Deploy this BEFORE the app, as with 007. Additive, so the old app keeps
 * working against the new table.
 *
 * Numbered 010 because 009 is `009_video_dim_asset_duration` (FILM-1710).
 * The two touch different columns and the runner applies by name, so they
 * are independent of each other's order.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `ALTER TABLE video_dim ADD COLUMN IF NOT EXISTS channel_language LowCardinality(String)`,
];

export const migration: ClickHouseMigration = {
  name: '010_video_dim_channel_language',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
