import { describe, expect, it } from 'vitest';

import {
  createRevenueProjectionFold,
  createRevenueSeriesFold,
  createRevenueSummaryFold,
  createTopContentFold,
  dashboardCurrencies,
  zeroRevenueSummary,
} from '../src/lib/revenue-by-currency';

const period = { start: '2026-09-01', end: '2026-09-10' };

const row = (
  currency: string | null,
  cents: number,
  overrides: Partial<{
    platform: string;
    category: string;
    source: string;
    episode_id: string | null;
  }> = {},
) => ({
  platform: 'youtube',
  category: 'ads',
  source: 'api',
  episode_id: 'episode-1',
  ...overrides,
  amount: { currency, cents },
});

/**
 * The reproduction in KB-12: $12.00 of ads and a €5.00 sponsorship on one
 * video. Every figure the dashboard drew from them was a figure of 1700.
 */
function dollarsAndEuros() {
  const fold = createRevenueSummaryFold();

  fold.add(row('USD', 1200));
  fold.add(row('EUR', 500, { category: 'sponsorship', source: 'manual' }));

  return fold;
}

describe('createRevenueSummaryFold', () => {
  it('reports one total per currency, never the sum of two', () => {
    const summaries = dollarsAndEuros().result({ period, totalViews: 0 });

    expect(
      summaries.map(({ currency, totalRevenueCents }) => ({
        currency,
        totalRevenueCents,
      })),
    ).toEqual([
      { currency: 'USD', totalRevenueCents: 1200 },
      { currency: 'EUR', totalRevenueCents: 500 },
    ]);
  });

  it('computes the mix and the ad share within a currency', () => {
    const [dollars, euros] = dollarsAndEuros().result({
      period,
      totalViews: 0,
    });

    // Across both, ads were "71%" of 1700. Of the dollars they are all of
    // it, and of the euros none.
    expect(dollars?.byType).toEqual({ ads: 1200 });
    expect(dollars?.adsSharePercent).toBe(100);
    expect(euros?.byType).toEqual({ sponsorship: 500 });
    expect(euros?.adsSharePercent).toBe(0);
    expect(euros?.nonAdSharePercent).toBe(100);
  });

  it('divides each currency by the views, never a mixed sum', () => {
    const [dollars, euros] = dollarsAndEuros().result({
      period,
      totalViews: 10_000,
    });

    // 1700 / 10000 × 1000 = 170 was the old RPM.
    expect(dollars?.allInRpmCents).toBe(120);
    expect(dollars?.adsRpmCents).toBe(120);
    expect(euros?.allInRpmCents).toBe(50);
    expect(euros?.adsRpmCents).toBe(0);
  });

  it('measures the trend against the same currency a period earlier', () => {
    const fold = dollarsAndEuros();

    fold.addPrevious({ currency: 'USD', cents: 1000 });
    fold.addPrevious({ currency: 'EUR', cents: 400 });

    const [dollars, euros] = fold.result({ period, totalViews: 0 });

    // Summed: (1700 - 1400) / 1400 = +21%, which is neither.
    expect(dollars?.trendPercent).toBeCloseTo(20);
    expect(euros?.trendPercent).toBeCloseTo(25);
  });

  it('keeps a currency that earned last period and nothing this one', () => {
    const fold = createRevenueSummaryFold();

    fold.add(row('USD', 1200));
    fold.addPrevious({ currency: 'EUR', cents: 500 });

    const [, euros] = fold.result({ period, totalViews: 0 });

    expect(euros).toMatchObject({
      currency: 'EUR',
      totalRevenueCents: 0,
      trendPercent: -100,
      trend: 'down',
    });
  });

  it('averages over the days of the period, per currency', () => {
    const [dollars, euros] = dollarsAndEuros().result({
      period,
      totalViews: 0,
    });

    expect(dollars?.averageDailyRevenueCents).toBe(120);
    expect(euros?.averageDailyRevenueCents).toBe(50);
  });

  it('is unchanged for an account with one currency', () => {
    const fold = createRevenueSummaryFold();

    fold.add(row('USD', 1200));
    fold.add(
      row('USD', 500, {
        category: 'sponsorship',
        source: 'manual',
        platform: 'manual',
        episode_id: null,
      }),
    );
    fold.addPrevious({ currency: 'USD', cents: 1000 });

    // Every figure the pre-KB-12 action returned for these rows.
    expect(fold.result({ period, totalViews: 10_000 })).toEqual([
      {
        totalRevenueCents: 1700,
        currency: 'USD',
        period,
        byPlatform: { youtube: 1200, manual: 500 },
        byContent: { 'episode-1': 1200 },
        byType: { ads: 1200, sponsorship: 500 },
        rpm: 170,
        totalViews: 10_000,
        adsRevenueCents: 1200,
        nonAdRevenueCents: 500,
        adsSharePercent: (1200 / 1700) * 100,
        nonAdSharePercent: 100 - (1200 / 1700) * 100,
        positiveRevenueCents: 1700,
        adsRpmCents: 120,
        allInRpmCents: 170,
        averageDailyRevenueCents: 170,
        trend: 'up',
        trendPercent: 70,
      },
    ]);
  });

  it('is empty when nothing was recorded, rather than zero dollars', () => {
    expect(
      createRevenueSummaryFold().result({ period, totalViews: 0 }),
    ).toEqual([]);
  });
});

describe('zeroRevenueSummary', () => {
  it('is a summary of nothing in the currency asked for', () => {
    expect(zeroRevenueSummary('EUR', period)).toMatchObject({
      currency: 'EUR',
      totalRevenueCents: 0,
      averageDailyRevenueCents: 0,
      trend: 'stable',
      trendPercent: 0,
    });
  });
});

describe('createRevenueSeriesFold', () => {
  it('draws one zero-filled series per currency', () => {
    const fold = createRevenueSeriesFold();

    fold.add({
      record_date: '2026-09-02',
      amount: { currency: 'USD', cents: 1200 },
    });
    fold.add({
      record_date: '2026-09-02',
      amount: { currency: 'EUR', cents: 500 },
    });

    // One series would have put 1700 on 09-02.
    expect(fold.result('2026-09-01', '2026-09-03')).toEqual([
      {
        currency: 'USD',
        points: [
          { date: '2026-09-01', revenueCents: 0 },
          { date: '2026-09-02', revenueCents: 1200 },
          { date: '2026-09-03', revenueCents: 0 },
        ],
      },
      {
        currency: 'EUR',
        points: [
          { date: '2026-09-01', revenueCents: 0 },
          { date: '2026-09-02', revenueCents: 500 },
          { date: '2026-09-03', revenueCents: 0 },
        ],
      },
    ]);
  });

  it('gives an account with no rows the flat line it always got', () => {
    expect(
      createRevenueSeriesFold().result('2026-09-01', '2026-09-02'),
    ).toEqual([
      {
        currency: 'USD',
        points: [
          { date: '2026-09-01', revenueCents: 0 },
          { date: '2026-09-02', revenueCents: 0 },
        ],
      },
    ]);
  });
});

describe('createRevenueProjectionFold', () => {
  it('projects each currency from its own days of data', () => {
    const fold = createRevenueProjectionFold(new Date('2026-09-05'));

    fold.add({
      record_date: '2026-09-10',
      amount: { currency: 'USD', cents: 1000 },
    });
    fold.add({
      record_date: '2026-09-11',
      amount: { currency: 'USD', cents: 1000 },
    });
    fold.add({
      record_date: '2026-09-11',
      amount: { currency: 'EUR', cents: 500 },
    });

    // Summed: 2500 over two days × 30 = 37500 of nothing.
    expect(
      fold
        .result()
        .map(({ currency, estimatedMonthlyRevenueCents, basedOnDays }) => ({
          currency,
          estimatedMonthlyRevenueCents,
          basedOnDays,
        })),
    ).toEqual([
      { currency: 'USD', estimatedMonthlyRevenueCents: 30_000, basedOnDays: 2 },
      { currency: 'EUR', estimatedMonthlyRevenueCents: 15_000, basedOnDays: 1 },
    ]);
  });
});

describe('createTopContentFold', () => {
  const details = (publishId: string) => ({
    publishId,
    episodeId: `episode-${publishId}`,
    title: publishId,
    platform: 'youtube',
  });

  it('ranks within a currency, and lists a video paid in two under both', () => {
    const fold = createTopContentFold();

    fold.add(details('a'), { currency: 'USD', cents: 1200 });
    fold.add(details('a'), { currency: 'EUR', cents: 500 });
    fold.add(details('b'), { currency: 'USD', cents: 1500 });

    const ranked = fold.result(new Map([['a', 10_000]]), 10);

    // Summed, `a` led with 1700.
    expect(
      ranked.map(({ currency, items }) => ({
        currency,
        items: items.map(({ publishId, revenueCents, rpm }) => ({
          publishId,
          revenueCents,
          rpm,
        })),
      })),
    ).toEqual([
      {
        currency: 'USD',
        items: [
          { publishId: 'b', revenueCents: 1500, rpm: 0 },
          { publishId: 'a', revenueCents: 1200, rpm: 120 },
        ],
      },
      {
        currency: 'EUR',
        items: [{ publishId: 'a', revenueCents: 500, rpm: 50 }],
      },
    ]);

    expect(fold.publishIds().sort()).toEqual(['a', 'b']);
  });
});

describe('dashboardCurrencies', () => {
  it('follows the summary', () => {
    expect(
      dashboardCurrencies(
        [{ currency: 'USD' }, { currency: 'EUR' }],
        [{ currency: 'GBP' }],
      ),
    ).toEqual(['USD', 'EUR']);
  });

  it('falls back to the projection, so a euro forecast is not drawn in dollars', () => {
    expect(dashboardCurrencies([], [{ currency: 'EUR' }])).toEqual(['EUR']);
  });

  it('shows an empty account the $0 it always saw', () => {
    expect(dashboardCurrencies([], [])).toEqual(['USD']);
  });
});
