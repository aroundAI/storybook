import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-162: TikTok reports no watch time, follower gain or saves, so
 * ClickHouse holds NULL for them, and a sum over only NULLs is NULL. The
 * account totals read that NULL with `Number()`, which is 0, and the
 * company dashboard showed "Watch Time 0m". Null is "cannot measure".
 */
vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => client),
}));

const json = vi.fn();

const client = {
  query: vi.fn((_args: { query: string }) => Promise.resolve({ json })),
  insert: vi.fn(),
  command: vi.fn(),
  close: vi.fn(),
};

const SCOPE = { projectId: '550e8400-e29b-41d4-a716-446655440000' };

/** What the server sends for TikTok rows: the three sums NULL, unmeasured. */
const tiktokRow = {
  views: '200',
  likes: '20',
  comments: '2',
  shares: '2',
  saves: null,
  watch_time_seconds: null,
  revenue_cents: '0',
  subscribers_gained: null,
  row_count: '2',
  shares_measured: 1,
  saves_measured: 0,
  watch_time_seconds_measured: 0,
  subscribers_gained_measured: 0,
};

/** A YouTube video beside it: watch time and follower gain measured. */
const youtubeRow = {
  ...tiktokRow,
  watch_time_seconds: '600',
  subscribers_gained: '4',
  watch_time_seconds_measured: 1,
  subscribers_gained_measured: 1,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
  process.env.CLICKHOUSE_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.CLICKHOUSE_HOST;
  delete process.env.CLICKHOUSE_ENABLED;
});

describe('queryTotals, for a figure no row measured (KB-162)', () => {
  it('gives an X-only scope null shares, not 0 (FILM-1727)', async () => {
    // X reports no shares (migration 021): the sum reads 0, the flag 0.
    json.mockResolvedValue([{ ...tiktokRow, shares: '0', shares_measured: 0 }]);
    const { queryTotals } = await import('../src/queries');

    const totals = await queryTotals(SCOPE);

    expect(totals.shares).toBeNull();
    expect(totals.likes).toBe(20);
  });

  it('gives null watch time, follower gain and saves over TikTok rows, not 0', async () => {
    json.mockResolvedValue([tiktokRow]);
    const { queryTotals } = await import('../src/queries');

    const totals = await queryTotals(SCOPE);

    expect(totals.watch_time_seconds).toBeNull();
    expect(totals.subscribers_gained).toBeNull();
    expect(totals.saves).toBeNull();
    // What TikTok does measure is still a number.
    expect(totals.views).toBe(200);
    expect(totals.likes).toBe(20);
  });

  it('keeps a measured figure, and a measured 0', async () => {
    json.mockResolvedValue([{ ...youtubeRow, saves: '0', saves_measured: 1 }]);
    const { queryTotals } = await import('../src/queries');

    const totals = await queryTotals(SCOPE);

    expect(totals.watch_time_seconds).toBe(600);
    expect(totals.subscribers_gained).toBe(4);
    expect(totals.saves).toBe(0);
  });

  it('sums only measured rows, and says which columns any row measured', async () => {
    json.mockResolvedValue([youtubeRow]);
    const { queryTotals } = await import('../src/queries');

    await queryTotals(SCOPE);

    const sql = client.query.mock.calls[0]?.[0].query ?? '';
    for (const column of [
      'saves',
      'watch_time_seconds',
      'subscribers_gained',
    ]) {
      expect(sql).toContain(
        `sumIf(${column}, ${column} IS NOT NULL) as ${column}`,
      );
      expect(sql).toContain(`count(${column}) > 0 as ${column}_measured`);
    }
  });

  it('gives null over no rows at all: nothing measured it', async () => {
    json.mockResolvedValue([
      {
        ...tiktokRow,
        views: null,
        likes: '0',
        comments: '0',
        shares: '0',
        row_count: '0',
      },
    ]);
    const { queryTotals } = await import('../src/queries');

    const totals = await queryTotals(SCOPE);

    expect(totals.views).toBe(0);
    expect(totals.watch_time_seconds).toBeNull();
  });

  it('gives null with ClickHouse off, which measures nothing', async () => {
    process.env.CLICKHOUSE_ENABLED = 'false';
    const { queryTotals } = await import('../src/queries');

    const totals = await queryTotals(SCOPE);

    expect(totals.watch_time_seconds).toBeNull();
    expect(totals.subscribers_gained).toBeNull();
    expect(totals.saves).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('adds measured chunks, and stays null when no chunk measured it', async () => {
    // Two requests' worth of ids: the totals are summed across them.
    const videoIds = Array.from({ length: 1500 }, (_, i) => `v-${i}`);
    const { queryTotals } = await import('../src/queries');

    json.mockResolvedValueOnce([youtubeRow]).mockResolvedValueOnce([tiktokRow]);
    const mixed = await queryTotals({ videoIds });

    expect(mixed.watch_time_seconds).toBe(600);
    expect(mixed.saves).toBeNull();
    expect(mixed.views).toBe(400);

    json.mockResolvedValueOnce([tiktokRow]).mockResolvedValueOnce([tiktokRow]);
    const tiktokOnly = await queryTotals({ videoIds });

    expect(tiktokOnly.watch_time_seconds).toBeNull();
    expect(tiktokOnly.subscribers_gained).toBeNull();
  });

  it('keeps Facebook-only views null across chunks (KB-153)', async () => {
    const videoIds = Array.from({ length: 1500 }, (_, i) => `v-${i}`);
    const facebookRow = { ...tiktokRow, views: null };
    const { queryTotals } = await import('../src/queries');

    json
      .mockResolvedValueOnce([facebookRow])
      .mockResolvedValueOnce([facebookRow]);
    const totals = await queryTotals({ videoIds });

    expect(totals.views).toBeNull();
    expect(totals.likes).toBe(40);
  });
});

describe('the daily series and platform split, for a figure no row measured (KB-162)', () => {
  it('daily watch time and saves are null on a day no row measured them', async () => {
    json.mockResolvedValue([{ ...tiktokRow, date: '2026-01-06' }]);
    const { queryDailyTimeSeries } = await import('../src/queries');

    const [day] = await queryDailyTimeSeries(SCOPE);

    expect(day?.watch_time_seconds).toBeNull();
    expect(day?.saves).toBeNull();
    expect(day?.views).toBe(200);
  });

  it('a platform’s saves are null where none of its rows measured them', async () => {
    json.mockResolvedValue([{ ...tiktokRow, platform: 'youtube' }]);
    const { queryPlatformBreakdown } = await import('../src/queries');

    const [youtube] = await queryPlatformBreakdown(SCOPE);

    expect(youtube?.saves).toBeNull();
  });
});
