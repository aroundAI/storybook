import { describe, expect, it } from 'vitest';

import {
  CLICKHOUSE_ID_CHUNK,
  chunkVideoIds,
  concatByChunk,
  mergeMapsByChunk,
  sumByChunk,
  sumRowsByKey,
  sumTotalsByChunk,
} from '../src/chunked';

const ids = (count: number, prefix = 'v') =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe('chunkVideoIds', () => {
  it('keeps a list that fits in one request as one chunk', () => {
    expect(chunkVideoIds(ids(CLICKHOUSE_ID_CHUNK))).toHaveLength(1);
  });

  it('splits past the chunk size', () => {
    const chunks = chunkVideoIds(ids(CLICKHOUSE_ID_CHUNK * 2 + 1));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(CLICKHOUSE_ID_CHUNK);
    expect(chunks[2]).toHaveLength(1);
  });

  it('deduplicates so a repeated id cannot be queried twice', () => {
    expect(chunkVideoIds(['a', 'b', 'a']).flat()).toEqual(['a', 'b']);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkVideoIds([])).toEqual([]);
  });
});

describe('mergeMapsByChunk', () => {
  it('assembles a per-video map across chunks', async () => {
    const all = ids(CLICKHOUSE_ID_CHUNK + 25);

    const merged = await mergeMapsByChunk(all, (chunk) =>
      Promise.resolve(new Map(chunk.map((id) => [id, { views: 1 }]))),
    );

    expect(merged.size).toBe(all.length);
    expect(merged.get('v0')).toEqual({ views: 1 });
  });

  it('never sums per-video values, since a video sits in one chunk only', async () => {
    // Per-video ratios (CTR, avg view duration) rely on this: they are
    // computed inside one chunk and must survive the merge untouched.
    const merged = await mergeMapsByChunk(['a', 'b'], (chunk) =>
      Promise.resolve(new Map(chunk.map((id) => [id, { ctr: 0.25 }]))),
    );

    expect(merged.get('a')).toEqual({ ctr: 0.25 });
  });
});

describe('concatByChunk', () => {
  it('concatenates rows from every chunk', async () => {
    const all = ids(CLICKHOUSE_ID_CHUNK + 10);

    const rows = await concatByChunk(all, (chunk) =>
      Promise.resolve(chunk.map((id) => ({ videoId: id, views: 2 }))),
    );

    expect(rows).toHaveLength(all.length);
  });
});

describe('sumRowsByKey', () => {
  it('sums numeric fields for rows sharing a key', () => {
    const merged = sumRowsByKey(
      [
        { platform: 'youtube', views: 10, likes: 1 },
        { platform: 'tiktok', views: 5, likes: 2 },
        { platform: 'youtube', views: 7, likes: 3 },
      ],
      (row) => row.platform,
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.platform === 'youtube')).toEqual({
      platform: 'youtube',
      views: 17,
      likes: 4,
    });
  });

  it('leaves non-numeric fields as first-seen', () => {
    const merged = sumRowsByKey(
      [
        { date: '2026-01-01', label: 'first', views: 1 },
        { date: '2026-01-01', label: 'second', views: 2 },
      ],
      (row) => row.date,
    );

    expect(merged[0]).toEqual({ date: '2026-01-01', label: 'first', views: 3 });
  });

  it('does not merge rows whose keys differ', () => {
    // The property that makes per-video rows safe: include the video in the
    // key and nothing can collide across chunks.
    const merged = sumRowsByKey(
      [
        { videoId: 'a', key: 'US', views: 3, percentage: 50 },
        { videoId: 'b', key: 'US', views: 4, percentage: 50 },
      ],
      (row) => `${row.videoId}|${row.key}`,
    );

    expect(merged).toHaveLength(2);
    expect(merged.every((r) => r.percentage === 50)).toBe(true);
  });

  it('keeps a null "not measured" null, and never drops a measured figure into it', () => {
    // Migration 021: an X row's shares are NULL. Two chunks that both
    // measured nothing stay null; one that did measure is not lost.
    const merged = sumRowsByKey<{ k: string; shares: number | null }>(
      [
        { k: 'x', shares: null },
        { k: 'x', shares: null },
        { k: 'mixed', shares: null },
        { k: 'mixed', shares: 4 },
        { k: 'mixed', shares: 3 },
      ],
      (row) => row.k,
    );

    expect(merged).toEqual([
      { k: 'x', shares: null },
      { k: 'mixed', shares: 7 },
    ]);
  });
});

describe('sumByChunk', () => {
  it('folds a grouping that spans chunks', async () => {
    const all = ids(CLICKHOUSE_ID_CHUNK + 1);

    // Every chunk reports the same two platforms, as a real grouped query
    // would — the totals must add up rather than the last chunk winning.
    const rows = await sumByChunk(
      all,
      (chunk) =>
        Promise.resolve([
          { platform: 'youtube', views: chunk.length },
          { platform: 'tiktok', views: 1 },
        ]),
      (row) => row.platform as string,
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.platform === 'youtube')?.views).toBe(all.length);
    expect(rows.find((r) => r.platform === 'tiktok')?.views).toBe(2);
  });
});

describe('sumTotalsByChunk', () => {
  const zero = { views: 0, likes: 0 };

  it('sums scalar totals across chunks', async () => {
    const all = ids(CLICKHOUSE_ID_CHUNK + 5);

    const totals = await sumTotalsByChunk(
      all,
      (chunk) => Promise.resolve({ views: chunk.length, likes: 1 }),
      zero,
    );

    expect(totals).toEqual({ views: all.length, likes: 2 });
  });

  it('returns the identity for an empty id list without querying', async () => {
    let called = false;

    const totals = await sumTotalsByChunk(
      [],
      () => {
        called = true;
        return Promise.resolve({ views: 1, likes: 1 });
      },
      zero,
    );

    expect(totals).toEqual(zero);
    expect(called).toBe(false);
  });

  it('does not mutate the zero value it is given', async () => {
    await sumTotalsByChunk(
      ids(3),
      () => Promise.resolve({ views: 5, likes: 5 }),
      zero,
    );

    expect(zero).toEqual({ views: 0, likes: 0 });
  });
});
