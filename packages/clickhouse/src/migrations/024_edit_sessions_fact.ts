/**
 * How each delivered episode was edited in StorybookStudio (FILM-2006).
 *
 * One row per delivered edit session, rolled up hourly by the analytics
 * sync from Postgres `edit_sessions` (status `delivered`) through
 * `deriveEditStyle` (@kit/desktop-integration). It is the only ClickHouse
 * object Phase 20 adds. FILM-1717's attribute analysis reads it as optional
 * edit-style dimensions joined on episode_id; nothing it already reads
 * changes.
 *
 * - Re-running the rollup inserts the same session again with a newer
 *   `synced_at`; ReplacingMergeTree keeps the newest, and readers collapse
 *   with FINAL, so the upsert is idempotent.
 * - NULL is "not recorded", never 0: a report without `style` has no cut
 *   count, shot length or hook; an older summary has no plan counts.
 * - Cut density and AI share are stored as `deriveEditStyle` computed them,
 *   beside the AC's columns, so the card, the fact and FILM-1717's analysis share one
 *   rule rather than a TypeScript copy and a SQL copy.
 *
 * Additive only. Deploy BEFORE the app, which writes the table.
 *
 * Rollback: roll the app back first, then
 *   DROP TABLE IF EXISTS edit_sessions_fact;
 */
import type { ClickHouseMigration } from './migration-types';

const STATEMENT = `CREATE TABLE IF NOT EXISTS edit_sessions_fact (
    session_id UUID,
    episode_id UUID,
    project_id UUID,
    account_id UUID,
    delivered_at DateTime64(3, 'UTC'),
    final_duration Float64,
    target_duration Nullable(Float64),
    ai_ops UInt32,
    user_ops UInt32,
    plans_proposed Nullable(UInt32),
    plans_approved Nullable(UInt32),
    cut_count Nullable(UInt32),
    avg_shot_length Nullable(Float64),
    hook_type Nullable(String),
    cuts_per_minute Nullable(Float64),
    ai_share Nullable(Float64),
    languages Array(String),
    presets Array(String),
    synced_at DateTime64(3, 'UTC') DEFAULT now64(3)
  )
  ENGINE = ReplacingMergeTree(synced_at)
  ORDER BY (project_id, episode_id, session_id)`;

export const migration: ClickHouseMigration = {
  name: '024_edit_sessions_fact',
  async up(client) {
    await client.command({ query: STATEMENT });
  },
};
