/**
 * Video dimension table (FILM-1506).
 *
 * ClickHouse carries no dimensions beyond project/video/platform/date, so
 * age-controlled and segment analytics (cohorts, back-catalog share,
 * medians by tag/language/content-type) were impossible. video_dim is
 * synced from Postgres (publish-success hook + nightly reconcile) and
 * joined FINAL by the deep-dive queries.
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS video_dim (
    video_id String,
    project_id UUID,
    account_id UUID,
    episode_id UUID,
    platform LowCardinality(String),
    content_type LowCardinality(String),
    language LowCardinality(String),
    title String,
    published_at DateTime,
    duration_seconds UInt32,
    tags Array(String),
    updated_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(updated_at)
  ORDER BY (video_id)`,
];

export const migration: ClickHouseMigration = {
  name: '005_video_dim',
  async up(client) {
    for (const query of STATEMENTS) {
      await client.command({ query });
    }
  },
};
