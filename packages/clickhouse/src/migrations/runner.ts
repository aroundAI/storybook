import type { ClickHouseClient } from '@clickhouse/client';

import type { ClickHouseMigration } from './migration-types';

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
    name String,
    applied_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY name
`;

/**
 * KB-200: an empty _migrations over a database that already has tables means
 * the record was lost, not that nothing ran. Re-running every migration then
 * would replay the destructive early ones (002 drops video_metrics).
 */
export class MigrationBaselineError extends Error {
  constructor(tables: string[]) {
    super(
      `_migrations is empty but the database already has tables (${tables.join(', ')}); ` +
        'refusing to re-run destructive migrations. Restore _migrations, or record ' +
        'the applied ones with `--baseline`.',
    );
    this.name = 'MigrationBaselineError';
  }
}

interface RunOptions {
  /** Record every migration as applied without running it. Never used by deploy.sh. */
  baseline?: boolean;
  log?: (message: string) => void;
}

export async function runMigrations(
  client: ClickHouseClient,
  migrations: ClickHouseMigration[],
  { baseline = false, log = console.log }: RunOptions = {},
) {
  await client.command({ query: MIGRATION_TABLE });

  const recorded = await client.query({
    query: 'SELECT name FROM _migrations',
    format: 'JSONEachRow',
  });
  const applied = new Set(
    (await recorded.json<{ name: string }>()).map((row) => row.name),
  );

  if (applied.size === 0) {
    const existing = await client.query({
      query: `SELECT name FROM system.tables
              WHERE database = currentDatabase() AND name != '_migrations'
              ORDER BY name`,
      format: 'JSONEachRow',
    });
    const tables = (await existing.json<{ name: string }>()).map(
      (row) => row.name,
    );

    if (tables.length > 0 && !baseline) {
      throw new MigrationBaselineError(tables);
    }
  }

  const result = {
    applied: [] as string[],
    skipped: [] as string[],
    baselined: [] as string[],
  };

  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      log(`  ⏭️  ${migration.name} already applied — skipping.`);
      result.skipped.push(migration.name);
      continue;
    }

    if (baseline) {
      log(`  📌 ${migration.name} recorded as applied (baseline, not run).`);
    } else {
      log(`  Applying ${migration.name}...`);
      await migration.up(client);
    }

    await client.insert({
      table: '_migrations',
      values: [{ name: migration.name }],
      format: 'JSONEachRow',
    });

    if (baseline) {
      result.baselined.push(migration.name);
    } else {
      log(`  ✅ ${migration.name} applied.`);
      result.applied.push(migration.name);
    }
  }

  return result;
}
