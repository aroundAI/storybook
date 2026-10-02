import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScopeTotals } from '@kit/clickhouse/server';

import { getAccountDashboardData } from '../src/server/account-dashboard-actions';

/**
 * KB-162: the company dashboard's cards read the account totals, which
 * gave an all-TikTok account a watch time and follower gain of 0 where
 * TikTok reported none. Null is "cannot measure", and reaches the cards.
 */
const state: {
  current: ScopeTotals;
  previous: ScopeTotals;
  hasProjects: boolean;
} = { current: totals(), previous: totals(), hasProjects: true };

function totals(overrides: Partial<ScopeTotals> = {}): ScopeTotals {
  return {
    views: 200,
    likes: 20,
    comments: 2,
    shares: 2,
    saves: null,
    watch_time_seconds: null,
    revenue_cents: 0,
    subscribers_gained: null,
    ...overrides,
  };
}

function builder(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    in: () => chain,
    gt: () => chain,
    order: () => chain,
    // One page: a second request reads past the end.
    range: async (from: number) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: rows, count: 0, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) =>
      builder(
        !state.hasProjects
          ? []
          : table === 'projects'
            ? [{ id: 'project-1', name: 'Project' }]
            : table === 'publishes'
              ? [{ id: 'tt-1', platform: 'tiktok', episodes: { id: 'e-1' } }]
              : [],
      ),
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: (date: Date) => date.toISOString().slice(0, 10),
  queryDailyTimeSeries: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotalsByVideoIds: async () => new Map(),
  queryTotals: vi.fn(),
}));

beforeEach(async () => {
  const { queryTotals } = await import('@kit/clickhouse/server');
  // The current period is asked for first, then the previous one.
  vi.mocked(queryTotals)
    .mockReset()
    .mockImplementationOnce(async () => state.current)
    .mockImplementationOnce(async () => state.previous);
  state.current = totals();
  state.previous = totals();
  state.hasProjects = true;
});

describe('the account dashboard, for figures no platform measured (KB-162)', () => {
  it('gives an all-TikTok account no watch time, follower gain or saves, not 0', async () => {
    const data = await getAccountDashboardData('account-1');

    expect(data.totals.watchTimeSeconds).toBeNull();
    expect(data.totals.subscribersGained).toBeNull();
    expect(data.totals.saves).toBeUndefined();
    expect(data.previousPeriodTotals.watchTimeSeconds).toBeNull();
    // What TikTok does measure is still a number.
    expect(data.totals.views).toBe(200);
  });

  it('keeps a measured watch time, follower gain and saves', async () => {
    state.current = totals({
      watch_time_seconds: 600,
      subscribers_gained: 4,
      saves: 0,
    });

    const data = await getAccountDashboardData('account-1');

    expect(data.totals.watchTimeSeconds).toBe(600);
    expect(data.totals.subscribersGained).toBe(4);
    expect(data.totals.saves).toBe(0);
  });

  it('measures nothing for an account with no publishes', async () => {
    state.hasProjects = false;

    const data = await getAccountDashboardData('account-1');

    expect(data.totals.watchTimeSeconds).toBeNull();
    expect(data.totals.subscribersGained).toBeNull();
  });

  // KB-166: the Views card's reason is read from this scope.
  it('says which platforms are behind the views and which had rows', async () => {
    const data = await getAccountDashboardData('account-1');

    expect(data.viewsScope).toEqual({
      platforms: ['tiktok'],
      withRows: [],
      windowLabel: 'the last 30 days',
    });
  });
});

/**
 * KB-167: a total of nothing measured read as 0 views. No publishes, or
 * ClickHouse failing, is not "nobody watched": the Views card says "Not
 * measured". A measured 0 is still 0.
 */
describe('the account dashboard, when nothing was measured (KB-167)', () => {
  it('gives no views, not 0, to an account with no projects', async () => {
    state.hasProjects = false;

    const data = await getAccountDashboardData('account-1');

    expect(data.totals.views).toBeNull();
    expect(data.previousPeriodTotals.views).toBeNull();
  });

  it('gives no views, not 0, when ClickHouse fails', async () => {
    const { queryTotals } = await import('@kit/clickhouse/server');
    vi.mocked(queryTotals)
      .mockReset()
      .mockRejectedValue(new Error('ClickHouse down'));

    const data = await getAccountDashboardData('account-1');

    expect(data.totals.views).toBeNull();
    expect(data.previousPeriodTotals.views).toBeNull();
  });

  it('passes on a period with no rows as null, and a measured 0 as 0', async () => {
    state.current = totals({ views: 0 });
    state.previous = totals({ views: null });

    const data = await getAccountDashboardData('account-1');

    expect(data.totals.views).toBe(0);
    expect(data.previousPeriodTotals.views).toBeNull();
  });
});
