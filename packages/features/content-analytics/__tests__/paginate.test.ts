import { describe, expect, it } from 'vitest';

import {
  chunkIds,
  fetchAllByIds,
  fetchAllRows,
} from '../src/server/lib/paginate';

/**
 * A fake table that honours a server-side row cap, the way PostgREST does:
 * a short page comes back with HTTP 200 and no error.
 */
function createTable(rowCount: number, serverCap = 1000) {
  const all = Array.from({ length: rowCount }, (_, index) => ({ id: index }));
  const ranges: Array<[number, number]> = [];

  return {
    ranges,
    page(from: number, to: number) {
      ranges.push([from, to]);
      const requested = to - from + 1;
      const size = Math.min(requested, serverCap);
      return Promise.resolve({
        data: all.slice(from, from + size),
        error: null,
      });
    },
  };
}

describe('fetchAllRows', () => {
  it('returns every row when the total exceeds the page size', async () => {
    const table = createTable(1234);

    const rows = await fetchAllRows(table.page);

    expect(rows).toHaveLength(1234);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[1233]).toEqual({ id: 1233 });
  });

  it('terminates when the row count is an exact multiple of the page size', async () => {
    const table = createTable(1000);

    const rows = await fetchAllRows(table.page);

    // 500 + 500 + one empty page proving there is nothing left.
    expect(rows).toHaveLength(1000);
    expect(table.ranges).toHaveLength(3);
  });

  it('handles an empty table in a single request', async () => {
    const table = createTable(0);

    expect(await fetchAllRows(table.page)).toEqual([]);
    expect(table.ranges).toEqual([[0, 499]]);
  });

  it('stays correct when the server cap is smaller than the page size', async () => {
    // The guarantee that matters: progress is measured by rows returned,
    // not by the requested page size, so a cap we did not anticipate
    // slows the loop down instead of silently truncating it.
    const table = createTable(700, 120);

    const rows = await fetchAllRows(table.page);

    expect(rows).toHaveLength(700);
    expect(rows.map((row) => row.id)).toEqual(
      Array.from({ length: 700 }, (_, index) => index),
    );
  });

  it('requests contiguous ranges with no gap or overlap', async () => {
    const table = createTable(1100);

    await fetchAllRows(table.page);

    let expectedFrom = 0;
    for (const [from] of table.ranges) {
      expect(from).toBe(expectedFrom);
      expectedFrom = from === 1000 ? 1100 : from + 500;
    }
  });

  it('throws on error rather than returning a partial result', async () => {
    await expect(
      fetchAllRows(() =>
        Promise.resolve({ data: null, error: { message: 'boom' } }),
      ),
    ).rejects.toThrow(/boom/);
  });

  it('names the failing query in the error', async () => {
    await expect(
      fetchAllRows(
        () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        'publishes',
      ),
    ).rejects.toThrow(/publishes/);
  });

  it('refuses to page forever', async () => {
    // A page that is always full simulates a table growing as fast as it
    // is read; without the guard this would never terminate.
    const endless = (from: number, to: number) =>
      Promise.resolve({
        data: Array.from({ length: to - from + 1 }, (_, i) => ({
          id: from + i,
        })),
        error: null,
      });

    await expect(fetchAllRows(endless)).rejects.toThrow(/exceeded/);
  });
});

describe('fetchAllByIds', () => {
  it('returns nothing without issuing a query for an empty id list', async () => {
    let called = false;

    const rows = await fetchAllByIds([], () => {
      called = true;
      return Promise.resolve({ data: [], error: null });
    });

    expect(rows).toEqual([]);
    expect(called).toBe(false);
  });

  it('splits a long id list into chunks', async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `id-${index}`);
    const chunks: string[][] = [];

    await fetchAllByIds(ids, (chunk) => {
      chunks.push(chunk);
      return Promise.resolve({ data: [], error: null });
    });

    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('paginates within a chunk, since one id can match many rows', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `id-${index}`);
    // 10 ids matching 600 rows — more than one page, well under the cap.
    const table = createTable(600);

    const rows = await fetchAllByIds(ids, (_chunk, from, to) =>
      table.page(from, to),
    );

    expect(rows).toHaveLength(600);
  });
});

describe('chunkIds', () => {
  it('chunks and preserves order', () => {
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });
});
