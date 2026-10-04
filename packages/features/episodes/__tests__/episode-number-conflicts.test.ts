import { describe, expect, it, vi } from 'vitest';

import {
  insertEpisode,
  insertEpisodesAtNextNumbers,
} from '../src/server/episode.service';

/**
 * KB-175: the database refuses a second live episode with a taken number
 * (23505). These tests drive the create paths against a fake client whose
 * highest number and insert results are scripted, so the retry and the
 * refusal are seen without a database.
 */
type InsertResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function fakeClient(options: {
  topNumbers: Array<number | null>;
  inserts: InsertResult[];
}) {
  const insertedRows: unknown[] = [];
  let topReads = 0;
  let insertCalls = 0;

  const client = {
    from: () => ({
      select: () => {
        const read = {
          eq: () => read,
          is: () => read,
          order: () => read,
          limit: async () => {
            const top = options.topNumbers[topReads++] ?? null;
            return { data: top === null ? [] : [{ number: top }] };
          },
        };
        return read;
      },
      insert: (rows: unknown) => {
        insertedRows.push(rows);
        const result = options.inserts[insertCalls++]!;
        const done = Promise.resolve(result);
        return {
          select: () => ({
            single: () => done,
            then: done.then.bind(done),
          }),
        };
      },
    }),
  };

  return {
    client: client as unknown as Parameters<typeof insertEpisode>[0],
    insertedRows,
    reads: () => topReads,
  };
}

const clash = {
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique' },
};

describe('insertEpisode number conflicts', () => {
  it('takes the next number again when a concurrent create took it', async () => {
    const fake = fakeClient({
      topNumbers: [1, 2],
      inserts: [clash, { data: { id: 'e', number: 3 }, error: null }],
    });

    const result = await insertEpisode(fake.client, {
      projectId: 'p',
      title: 'Third',
    });

    expect(result).toEqual({ ok: true, data: { id: 'e', number: 3 } });
    expect(
      fake.insertedRows.map((row) => (row as { number: number }).number),
    ).toEqual([2, 3]);
  });

  it('refuses a chosen number that is taken, without retrying', async () => {
    const fake = fakeClient({ topNumbers: [], inserts: [clash] });

    const result = await insertEpisode(fake.client, {
      projectId: 'p',
      title: 'Again',
      number: 1,
    });

    expect(result).toEqual({
      ok: false,
      field: 'number',
      refusal:
        'Episode 1 already exists in this project. Choose a different number.',
    });
    expect(fake.insertedRows).toHaveLength(1);
  });

  it('throws when every attempt at an auto number clashed', async () => {
    const fake = fakeClient({
      topNumbers: [1, 2, 3],
      inserts: [clash, clash, clash],
    });

    await expect(
      insertEpisode(fake.client, { projectId: 'p', title: 'Busy' }),
    ).rejects.toThrow(/Failed to create episode/);
  });
});

describe('insertEpisodesAtNextNumbers', () => {
  const rowsFrom = (first: number) =>
    [first, first + 1].map((number) => ({
      project_id: 'p',
      number,
      title: `Episode ${number}`,
    }));

  it('numbers the rows from the project-wide top and reads it again on a clash', async () => {
    const fake = fakeClient({
      topNumbers: [4, 6],
      inserts: [clash, { data: [{ id: 'a' }, { id: 'b' }], error: null }],
    });
    const warn = vi.fn();

    const inserted = await insertEpisodesAtNextNumbers(
      fake.client,
      'p',
      rowsFrom,
      { warn },
    );

    expect(inserted).toHaveLength(2);
    expect(
      fake.insertedRows.map((rows) =>
        (rows as Array<{ number: number }>).map((row) => row.number),
      ),
    ).toEqual([
      [5, 6],
      [7, 8],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error that is not a number clash', async () => {
    const fake = fakeClient({
      topNumbers: [0],
      inserts: [{ data: null, error: { code: '42501', message: 'denied' } }],
    });

    await expect(
      insertEpisodesAtNextNumbers(fake.client, 'p', rowsFrom),
    ).rejects.toThrow('Failed to create episodes: denied');
    expect(fake.reads()).toBe(1);
  });
});
