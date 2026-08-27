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
import type { ClickHouseMigration } from './migration-types';

const MIGRATIONS: ClickHouseMigration[] = [m001, m002, m003, m004];

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
