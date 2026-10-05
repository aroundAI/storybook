/**
 * ClickHouse Migration Runner
 *
 * Applies pending migrations in order and records them in the _migrations
 * table. Safe to re-run: already-applied migrations are skipped.
 *
 * Usage: pnpm --filter @kit/clickhouse migrate
 */
import { closeClickHouseClient, getClickHouseClient } from '../client';
import { migration as m001 } from './001_create_tables';
import { migration as m002 } from './002_metrics_v2';
import { migration as m003 } from './003_reach_and_traffic';
import { migration as m004 } from './004_extended_metrics';
import { migration as m005 } from './005_video_dim';
import { migration as m006 } from './006_gross_subscribers';
import { migration as m007 } from './007_video_dim_connection';
import { migration as m008 } from './008_channel_subscribers';
import { migration as m009 } from './009_video_dim_asset_duration';
import { migration as m010 } from './010_video_dim_channel_language';
import { migration as m011 } from './011_channel_reach_residual';
import { migration as m012 } from './012_video_metrics_engaged_views';
import { migration as m013 } from './013_unmeasured_is_null';
import { migration as m014 } from './014_unmeasured_counters_null';
import { migration as m015 } from './015_accounts_reached';
import { migration as m016 } from './016_channel_windows';
import { migration as m017 } from './017_snapshot_unmeasured_null';
import { migration as m018 } from './018_reposts';
import { migration as m019 } from './019_all_surface_aggregates';
import { migration as m020 } from './020_facebook';
import { migration as m021 } from './021_twitter';
import { migration as m022 } from './022_video_revenue_daily';
import { migration as m023 } from './023_reels_attention';
import { migration as m024 } from './024_edit_sessions_fact';
import type { ClickHouseMigration } from './migration-types';

const MIGRATIONS: ClickHouseMigration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
  m016,
  m017,
  m018,
  m019,
  m020,
  m021,
  m022,
  m023,
  m024,
];

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
    name String,
    applied_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY name
`;

async function runMigrations() {
  console.log('🚀 Running ClickHouse migrations...\n');

  const client = getClickHouseClient();

  try {
    await client.command({ query: MIGRATION_TABLE });

    const result = await client.query({
      query: 'SELECT name FROM _migrations',
      format: 'JSONEachRow',
    });
    const applied = new Set(
      (await result.json<{ name: string }>()).map((row) => row.name),
    );

    let appliedCount = 0;

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) {
        console.log(`  ⏭️  ${migration.name} already applied — skipping.`);
        continue;
      }

      console.log(`  Applying ${migration.name}...`);
      await migration.up(client);
      await client.insert({
        table: '_migrations',
        values: [{ name: migration.name }],
        format: 'JSONEachRow',
      });
      console.log(`  ✅ ${migration.name} applied.`);
      appliedCount++;
    }

    const tables = await client.query({
      query: 'SHOW TABLES',
      format: 'JSONEachRow',
    });
    const tableList = await tables.json<{ name: string }>();
    console.log('\n  📋 Tables:', tableList.map((t) => t.name).join(', '));

    console.log(
      appliedCount > 0
        ? `\n✅ ${appliedCount} migration(s) applied.`
        : '\n✅ Nothing to do.',
    );
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await closeClickHouseClient();
  }
}

void runMigrations();
