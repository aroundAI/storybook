import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { insertSeason } from '../src/server/season.service';

/**
 * FILM-2201: one insertSeason for the season dialog, the episode wizard's
 * inline season and Generate Season. Live season numbers are unique per
 * project (seasons_project_id_number_active_idx), so a create that races
 * another gets 23505. These tests script the highest number and the insert
 * results, so the retry and the refusal are seen without a database.
 */
type InsertResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function fakeClient(options: {
  topNumbers: Array<number | null>;
  inserts: InsertResult[];
}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const readFilters: string[][] = [];
  let topReads = 0;
  let insertCalls = 0;

  const client = {
    from: () => ({
      select: () => {
        const filters: string[] = [];
        readFilters.push(filters);
        const read = {
          eq: (column: string) => (filters.push(`eq:${column}`), read),
          is: (column: string) => (filters.push(`is:${column}`), read),
          order: () => read,
          limit: async () => {
            const top = options.topNumbers[topReads++] ?? null;
            return { data: top === null ? [] : [{ number: top }], error: null };
          },
        };
        return read;
      },
      insert: (row: Record<string, unknown>) => {
        insertedRows.push(row);
        const result = options.inserts[insertCalls++]!;
        return { select: () => ({ single: () => Promise.resolve(result) }) };
      },
    }),
  };

  return {
    client: client as unknown as Parameters<typeof insertSeason>[0],
    insertedRows,
    readFilters,
  };
}

const clash = {
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique' },
};

describe('insertSeason', () => {
  it('numbers after the highest live season', async () => {
    const fake = fakeClient({
      topNumbers: [2],
      inserts: [{ data: { id: 's', number: 3 }, error: null }],
    });

    const result = await insertSeason(fake.client, {
      projectId: 'p',
      name: 'Origins',
    });

    expect(result).toEqual({ ok: true, data: { id: 's', number: 3 } });
    expect(fake.insertedRows[0]).toMatchObject({
      project_id: 'p',
      number: 3,
      name: 'Origins',
      description: null,
      direction_notes: null,
    });
    // A deleted season's number is free again: only live seasons count
    expect(fake.readFilters[0]).toContain('is:deleted_at');
  });

  it('takes the next number again when a concurrent create took it', async () => {
    const fake = fakeClient({
      topNumbers: [1, 2],
      inserts: [clash, { data: { id: 's', number: 3 }, error: null }],
    });

    const result = await insertSeason(fake.client, {
      projectId: 'p',
      name: 'Raced',
    });

    expect(result.ok).toBe(true);
    expect(fake.insertedRows.map((row) => row.number)).toEqual([2, 3]);
  });

  it('refuses a chosen number that is taken, without retrying', async () => {
    const fake = fakeClient({ topNumbers: [], inserts: [clash] });

    const result = await insertSeason(fake.client, {
      projectId: 'p',
      name: 'Again',
      number: 1,
    });

    expect(result).toEqual({
      ok: false,
      field: 'number',
      refusal:
        'Season 1 already exists in this project. Choose a different number.',
    });
    expect(fake.insertedRows).toHaveLength(1);
  });

  it('throws when every attempt at an auto number clashed', async () => {
    const fake = fakeClient({
      topNumbers: [1, 2, 3],
      inserts: [clash, clash, clash],
    });

    await expect(
      insertSeason(fake.client, { projectId: 'p', name: 'Busy' }),
    ).rejects.toThrow(/Failed to create season/);
  });

  it('throws on a failure other than a clash, without retrying', async () => {
    const fake = fakeClient({
      topNumbers: [0],
      inserts: [{ data: null, error: { code: '42501', message: 'denied' } }],
    });

    await expect(
      insertSeason(fake.client, { projectId: 'p', name: 'Viewer' }),
    ).rejects.toThrow('Failed to create season: denied');
    expect(fake.insertedRows).toHaveLength(1);
  });

  it('names an unnamed season after its number, as Generate Season always has', async () => {
    const fake = fakeClient({
      topNumbers: [4],
      inserts: [{ data: { id: 's', number: 5 }, error: null }],
    });

    await insertSeason(fake.client, { projectId: 'p' });

    expect(fake.insertedRows[0]).toMatchObject({ name: 'Season 5' });
  });
});

/**
 * Three copies of "insert a season" drifted apart: two of them never retried
 * a number race. The service is now the only one.
 */
describe('one season insert', () => {
  const repo = path.resolve(__dirname, '../../../..');
  const roots = ['packages', 'apps/web/app', 'apps/web/lib', 'apps/web/lambda'];
  const service = path.join(
    repo,
    'packages/features/episodes/src/server/season.service.ts',
  );

  function* sources(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) yield* sources(full);
      else if (/\.tsx?$/.test(entry)) yield full;
    }
  }

  it('has no insert into seasons outside season.service.ts', () => {
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of sources(path.join(repo, root))) {
        if (file === service) continue;
        const text = readFileSync(file, 'utf8');
        if (/from\(\s*'seasons'\s*\)\s*\.insert\(/.test(text)) {
          offenders.push(path.relative(repo, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
