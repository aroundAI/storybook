import { describe, expect, it, vi } from 'vitest';

import { recordViewsDenominator } from '@kit/clickhouse';
import type { PerVideoTotals } from '@kit/clickhouse';

import {
  getRevenueSummaryAction,
  getTopContentByRevenueAction,
} from '../src/server/revenue-actions';
import type { AccountRevenueRow } from '../src/server/revenue-queries';

/**
 * FILM-1732: an RPM keeps its numeric fields and carries a sibling
 * `rpmDenominator`. The figures are the ones these actions returned before;
 * the record names the platforms whose publishes had rows in the window.
 *
 * The window runs 2026-08-15 to 2026-09-14, across YouTube's 2026-08-27
 * change, and the account has a Facebook publish (views NULL, so recorded
 * as not in the denominator). The TikTok publish has no rows in the window.
 *
 * | publish | platform | views | revenue in the window          |
 * |---------|----------|-------|--------------------------------|
 * | yt-1    | youtube  | 5,000 | 900 + 300 ads, 500 sponsorship |
 * | fb-1    | facebook |  null | 400 ads                        |
 * | tt-1    | tiktok   |     — | none                           |
 */
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const WINDOW = { from: '2026-08-15', to: '2026-09-14' };
const INPUT = {
  accountId: ACCOUNT_ID,
  startDate: WINDOW.from,
  endDate: WINDOW.to,
};

const PUBLISHES = [
  { id: 'yt-1', platform: 'youtube' },
  { id: 'fb-1', platform: 'facebook' },
  { id: 'tt-1', platform: 'tiktok' },
];

const REVENUE: AccountRevenueRow[] = [
  revenue('r1', 'yt-1', 'youtube', '2026-08-20', 900, 'ads'),
  revenue('r2', 'yt-1', 'youtube', '2026-09-02', 300, 'ads'),
  revenue('r3', 'yt-1', 'youtube', '2026-09-03', 500, 'sponsorship'),
  revenue('r4', 'fb-1', 'facebook', '2026-09-05', 400, 'ads'),
];

function revenue(
  id: string,
  publishId: string,
  platform: string,
  recordDate: string,
  cents: number,
  category: string,
): AccountRevenueRow {
  return {
    id,
    publish_id: publishId,
    platform,
    record_date: recordDate,
    amount: { currency: 'USD', cents },
    source: 'platform_api',
    category,
    episode_id: `episode-${publishId}`,
  };
}

function perVideo(views: number | null): PerVideoTotals {
  return {
    views,
    likes: 0,
    comments: 0,
    shares: 0,
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

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (data: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryTotalsByVideoIds: async (ids: string[]) => {
    const views: Record<string, number | null> = {
      'yt-1': 5000,
      'fb-1': null,
    };

    return new Map(
      ids.flatMap((id) =>
        id in views ? [[id, perVideo(views[id] ?? null)] as const] : [],
      ),
    );
  },
}));

vi.mock('../src/server/revenue-queries', () => ({
  forEachAccountRevenueRow: async (
    _client: unknown,
    _accountId: string,
    from: string,
    to: string,
    onRow: (row: AccountRevenueRow) => void,
    options?: { toExclusive?: boolean },
  ) => {
    for (const row of REVENUE) {
      const before = options?.toExclusive
        ? row.record_date < to
        : row.record_date <= to;

      if (row.record_date >= from && before) onRow(row);
    }
  },
}));

function builder(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    not: () => chain,
    order: () => chain,
    range: async (from: number) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
  };

  return chain;
}

/** `revenue_records` as the top-content read selects it, joined to its publish. */
const TOP_CONTENT_ROWS = REVENUE.map((row) => ({
  publish_id: row.publish_id,
  revenue_cents: row.amount.cents,
  currency: row.amount.currency,
  platform: row.platform,
  publishes: {
    episode_id: row.episode_id,
    platform: row.platform,
    thumbnail_url: null,
    episodes: { title: `Title ${row.publish_id}` },
  },
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) =>
      builder(table === 'publishes' ? PUBLISHES : TOP_CONTENT_ROWS),
  }),
}));

const record = (platforms: string[]) =>
  recordViewsDenominator({ platforms, window: WINDOW });

describe('getRevenueSummaryAction, recorded (FILM-1732)', () => {
  it('keeps the RPM figures: revenue / views × 1000', async () => {
    const [summary] = await getRevenueSummaryAction(INPUT);

    expect(summary?.totalViews).toBe(5000);
    // 2,100 cents over 5,000 views; Facebook's null views add none.
    expect(summary?.rpm).toBeCloseTo(420, 10);
    expect(summary?.allInRpmCents).toBeCloseTo(420, 10);
  });

  it('records the platforms with rows over the window, across the 2026-08-27 change', async () => {
    const [summary] = await getRevenueSummaryAction(INPUT);

    expect(summary?.rpmDenominator).toEqual(record(['youtube', 'facebook']));
    expect(summary?.rpmDenominator.crosses.map((c) => c.date)).toEqual([
      '2026-08-27',
    ]);
    expect(
      summary?.rpmDenominator.platforms.find(
        (part) => part.platform === 'facebook',
      ),
    ).toMatchObject({ inDenominator: false });
  });
});

describe('getTopContentByRevenueAction, recorded (FILM-1732)', () => {
  it('keeps each item’s RPM, and 0 for a publish with no views', async () => {
    const [usd] = await getTopContentByRevenueAction({ ...INPUT, limit: 10 });
    const item = (id: string) =>
      usd?.items.find((entry) => entry.publishId === id);

    // 1,700 cents over 5,000 views
    expect(item('yt-1')?.revenueCents).toBe(1700);
    expect(item('yt-1')?.rpm).toBeCloseTo(340, 10);
    // Facebook: no views to divide by.
    expect(item('fb-1')?.views).toBe(0);
    expect(item('fb-1')?.rpm).toBe(0);
  });

  it('records each item over its own platform and the window', async () => {
    const [usd] = await getTopContentByRevenueAction({ ...INPUT, limit: 10 });
    const item = (id: string) =>
      usd?.items.find((entry) => entry.publishId === id);

    expect(item('yt-1')?.rpmDenominator).toEqual(record(['youtube']));
    expect(item('fb-1')?.rpmDenominator).toEqual(record(['facebook']));
    expect(item('fb-1')?.rpmDenominator.platforms).toEqual([
      expect.objectContaining({ platform: 'facebook', inDenominator: false }),
    ]);
  });
});
