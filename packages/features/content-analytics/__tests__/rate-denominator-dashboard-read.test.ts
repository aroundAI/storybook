import { describe, expect, it, vi } from 'vitest';

import { recordViewsDenominator } from '@kit/clickhouse';
import type { PerVideoTotals, ScopeTotals } from '@kit/clickhouse/server';

import { getAccountDashboardData } from '../src/server/account-dashboard-actions';

/**
 * FILM-1732: the company dashboard's engagement rates come back recorded —
 * the total, and each top item's. The figure is the one the dashboard
 * showed before; the record names the platforms whose publishes had rows in
 * the window, over the startDate..endDate passed.
 *
 * The window runs 2026-08-15 to 2026-09-14, across YouTube's 2026-08-27
 * change, and holds a Facebook publish (views NULL, so not in the
 * denominator). The TikTok publish has no rows in the window, so it pooled
 * nothing and is not in the record.
 *
 * | publish | platform | views | likes | comments | shares |
 * |---------|----------|-------|-------|----------|--------|
 * | yt-1    | youtube  | 3,000 |    90 |       20 |     10 |
 * | fb-1    | facebook |  null |    50 |        5 |      5 |
 * | tt-1    | tiktok   |     — | no rows in the window      |
 */
const START = new Date('2026-08-15T12:00:00Z');
const END = new Date('2026-09-14T12:00:00Z');
const WINDOW = { from: '2026-08-15', to: '2026-09-14' };

const PUBLISHES = [
  { id: 'yt-1', platform: 'youtube', title: 'YouTube', episodes: { id: 'e1' } },
  {
    id: 'fb-1',
    platform: 'facebook',
    title: 'Facebook',
    episodes: { id: 'e2' },
  },
  { id: 'tt-1', platform: 'tiktok', title: 'TikTok', episodes: { id: 'e3' } },
];

const CURRENT: ScopeTotals = {
  views: 3000,
  likes: 140,
  comments: 25,
  shares: 15,
  saves: null,
  watch_time_seconds: null,
  revenue_cents: 0,
  subscribers_gained: null,
};

function perVideo(
  views: number | null,
  likes: number,
  comments: number,
  shares: number,
): PerVideoTotals {
  return {
    views,
    likes,
    comments,
    shares,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents: null,
    subscribers_gained: 0,
    measured: {
      shares: true,
      saves: false,
      watch_time_seconds: false,
      subscribers_gained: false,
    },
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
        table === 'projects'
          ? [{ id: 'project-1', name: 'Project' }]
          : table === 'publishes'
            ? PUBLISHES
            : [],
      ),
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  formatDateStr: (date: Date) => date.toISOString().slice(0, 10),
  queryDailyTimeSeries: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotals: async () => CURRENT,
  queryTotalsByVideoIds: async () =>
    new Map([
      ['yt-1', perVideo(3000, 90, 20, 10)],
      ['fb-1', perVideo(null, 50, 5, 5)],
    ]),
}));

const read = () =>
  getAccountDashboardData('account-1', { startDate: START, endDate: END });

describe('the account dashboard’s engagement rates, recorded (FILM-1732)', () => {
  it('keeps the total figure: (likes + comments + shares) / views × 100', async () => {
    const data = await read();

    // (140 + 25 + 15) / 3,000
    expect(data.engagementRate?.value).toBeCloseTo(6, 10);
  });

  it('records the total over the platforms with rows, across the 2026-08-27 change', async () => {
    const { engagementRate } = await read();

    expect(engagementRate?.denominator).toEqual(
      recordViewsDenominator({
        platforms: ['youtube', 'facebook'],
        window: WINDOW,
      }),
    );
    expect(engagementRate?.denominator.crosses.map((c) => c.date)).toEqual([
      '2026-08-27',
    ]);
    expect(
      engagementRate?.denominator.platforms.find(
        (part) => part.platform === 'facebook',
      ),
    ).toMatchObject({ inDenominator: false });
  });

  it('keeps each top item’s figure, and none for a publish with no views', async () => {
    const { topContent } = await read();
    const item = (id: string) => topContent.find((entry) => entry.id === id);

    // (90 + 20 + 10) / 3,000
    expect(item('yt-1')?.engagementRate?.value).toBeCloseTo(4, 10);
    expect(item('fb-1')?.engagementRate).toBeNull();
    expect(item('tt-1')).toBeUndefined();
  });

  it('records each top item over its own platform and the window', async () => {
    const { topContent } = await read();
    const youtube = topContent.find((entry) => entry.id === 'yt-1');

    expect(youtube?.engagementRate?.denominator).toEqual(
      recordViewsDenominator({ platforms: ['youtube'], window: WINDOW }),
    );
  });
});
