import { describe, expect, it, vi } from 'vitest';

import {
  DELETE_LEGACY_TRAFFIC,
  STATEMENTS,
  copyLegacyTrafficMonth,
  migration,
} from '../src/migrations/025_complete_collection';

/**
 * KB-201: production refused 025's single copy of the pre-025 traffic rows,
 * because it raised max_partitions_per_insert_block and the managed server
 * forbids changing that setting. The copy now runs one month at a time.
 */
function fakeClient(months: number[]) {
  const commands: string[] = [];
  const client = {
    command: vi.fn(async ({ query }: { query: string }) => {
      commands.push(query);
    }),
    query: vi.fn(async () => ({
      json: async () => months.map((month) => ({ month: String(month) })),
    })),
  };
  return { client, commands };
}

describe('migration 025 copies the old traffic rows one month at a time (KB-201)', () => {
  it('changes no server setting anywhere', () => {
    const all = [
      ...STATEMENTS,
      DELETE_LEGACY_TRAFFIC,
      copyLegacyTrafficMonth(202409),
    ].join('\n');
    expect(all).not.toMatch(/max_partitions_per_insert_block/);
  });

  it('inserts once per month that holds old rows, then deletes them, then creates the channel table', async () => {
    const { client, commands } = fakeClient([202408, 202409, 202410]);
    await migration.up(client as never);

    const inserts = commands.filter((q) => q.startsWith('INSERT'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toContain('toYYYYMM(metric_date) = 202408');
    expect(inserts[2]).toContain('toYYYYMM(metric_date) = 202410');

    const deleteAt = commands.indexOf(DELETE_LEGACY_TRAFFIC);
    const lastInsertAt = commands.lastIndexOf(inserts[2]!);
    const createAt = commands.findIndex((q) =>
      q.includes('CREATE TABLE IF NOT EXISTS channel_metrics_daily'),
    );
    expect(deleteAt).toBeGreaterThan(lastInsertAt);
    expect(createAt).toBeGreaterThan(deleteAt);
  });

  it('with no old rows, copies nothing and still finishes', async () => {
    const { client, commands } = fakeClient([]);
    await migration.up(client as never);
    expect(commands.filter((q) => q.startsWith('INSERT'))).toHaveLength(0);
    expect(commands).toContain(DELETE_LEGACY_TRAFFIC);
  });

  it('refuses a month that is not YYYYMM', () => {
    expect(() => copyLegacyTrafficMonth(2024)).toThrow();
  });
});
