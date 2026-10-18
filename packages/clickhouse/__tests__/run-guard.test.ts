import type { ClickHouseClient } from '@clickhouse/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { migration as m002 } from '../src/migrations/002_metrics_v2';
import type { ClickHouseMigration } from '../src/migrations/migration-types';
import {
  MigrationBaselineError,
  runMigrations,
} from '../src/migrations/runner';

/**
 * KB-200: the runner refuses to re-run every migration over a database whose
 * _migrations is empty but whose tables exist, and 002 never drops a
 * video_metrics that holds rows.
 */

function fakeClient(state: {
  recorded?: string[];
  tables?: string[];
  videoMetricsRows?: number;
}) {
  const recorded = [...(state.recorded ?? [])];
  const commands: string[] = [];

  const client = {
    command: vi.fn(async ({ query }: { query: string }) => {
      commands.push(query.trim());
    }),
    query: vi.fn(async ({ query }: { query: string }) => {
      let rows: unknown[] = [];
      if (query.includes('FROM _migrations')) {
        rows = recorded.map((name) => ({ name }));
      } else if (query.includes("name = 'video_metrics'")) {
        rows =
          state.videoMetricsRows === undefined
            ? []
            : [{ total_rows: String(state.videoMetricsRows) }];
      } else if (query.includes('system.tables')) {
        rows = (state.tables ?? []).map((name) => ({ name }));
      }
      return { json: async () => rows };
    }),
    insert: vi.fn(async ({ values }: { values: { name: string }[] }) => {
      recorded.push(...values.map((v) => v.name));
    }),
  };

  return {
    client: client as unknown as ClickHouseClient,
    recorded,
    commands,
  };
}

function migrations(...names: string[]) {
  return names.map((name) => ({
    name,
    up: vi.fn(async () => {}),
  })) satisfies ClickHouseMigration[];
}

const quiet = () => {};

describe('runMigrations', () => {
  it('refuses when _migrations is empty but tables exist, and applies nothing', async () => {
    const { client, recorded } = fakeClient({
      tables: ['video_metrics', 'video_snapshots'],
    });
    const list = migrations('001_a', '002_b');

    await expect(runMigrations(client, list, { log: quiet })).rejects.toThrow(
      MigrationBaselineError,
    );
    await expect(runMigrations(client, list, { log: quiet })).rejects.toThrow(
      /_migrations is empty but the database already has tables/,
    );

    expect(list[0]!.up).not.toHaveBeenCalled();
    expect(list[1]!.up).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('applies everything on a fresh database', async () => {
    const { client, recorded } = fakeClient({});
    const list = migrations('001_a', '002_b');

    const result = await runMigrations(client, list, { log: quiet });

    expect(list[0]!.up).toHaveBeenCalledOnce();
    expect(list[1]!.up).toHaveBeenCalledOnce();
    expect(recorded).toEqual(['001_a', '002_b']);
    expect(result.applied).toEqual(['001_a', '002_b']);
  });

  it('with baseline, records every migration without running it', async () => {
    const { client, recorded } = fakeClient({ tables: ['video_metrics'] });
    const list = migrations('001_a', '002_b');

    const result = await runMigrations(client, list, {
      baseline: true,
      log: quiet,
    });

    expect(list[0]!.up).not.toHaveBeenCalled();
    expect(list[1]!.up).not.toHaveBeenCalled();
    expect(recorded).toEqual(['001_a', '002_b']);
    expect(result.baselined).toEqual(['001_a', '002_b']);
  });

  it('skips migrations already recorded and applies only new ones', async () => {
    const { client, recorded } = fakeClient({
      recorded: ['001_a'],
      tables: ['video_metrics'],
    });
    const list = migrations('001_a', '002_b');

    const result = await runMigrations(client, list, { log: quiet });

    expect(list[0]!.up).not.toHaveBeenCalled();
    expect(list[1]!.up).toHaveBeenCalledOnce();
    expect(recorded).toEqual(['001_a', '002_b']);
    expect(result).toMatchObject({ skipped: ['001_a'], applied: ['002_b'] });
  });
});

describe('002_metrics_v2', () => {
  it('keeps video_metrics when it holds rows', async () => {
    const { client, commands } = fakeClient({ videoMetricsRows: 42 });

    await m002.up(client);

    expect(commands).not.toContain('DROP TABLE IF EXISTS video_metrics');
    expect(commands).toContain('DROP TABLE IF EXISTS video_daily_stats');
  });

  it('drops an empty video_metrics as before', async () => {
    const { client, commands } = fakeClient({ videoMetricsRows: 0 });

    await m002.up(client);

    expect(commands).toContain('DROP TABLE IF EXISTS video_metrics');
  });
});

describe('deploy.sh ClickHouse step', () => {
  const deploy = readFileSync(
    resolve(import.meta.dirname, '../../../scripts/deploy.sh'),
    'utf8',
  );
  const step = deploy.slice(
    deploy.indexOf('# 5b. Apply ClickHouse Migrations'),
    deploy.indexOf('# 6. Build Application'),
  );

  it('calls the runner once', () => {
    expect(step).toContain('packages/clickhouse/src/migrations/run.ts');
    expect(step.match(/npx tsx /g)).toHaveLength(1);
  });

  it('loops over no migration files and never passes --baseline', () => {
    expect(step).not.toMatch(/for \w+ in \$MIGRATION_FILES/);
    expect(step).not.toContain('MIGRATIONS_DIR"/*.ts');
    expect(step).not.toMatch(/run\.ts[^\n]*--baseline/);
  });
});
