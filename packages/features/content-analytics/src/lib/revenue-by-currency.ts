/**
 * The revenue dashboard's folds, one result per currency (KB-12).
 *
 * Pure and streaming, for the reason `segment-revenue.ts` is: revenue lives
 * in Postgres a row per publish per day per category, and arithmetic buried
 * in a server action cannot be tested without a database.
 *
 * Each fold keeps its state in a `createCurrencyPartition`, so the
 * arithmetic inside one part is the arithmetic the dashboard always did —
 * what changed is that it can no longer see a row from another currency.
 * That is also what keeps a single-currency account's figures identical.
 *
 * A share, a trend and an RPM are all computed **within** a currency. A
 * share of a sum across two needs an exchange rate, and there are none here.
 */
import { recordViewsDenominator, rpmCents } from '@kit/clickhouse';
import type { DenominatorStamp, DenominatorWindow } from '@kit/clickhouse';

import type { CurrencyAmount } from './money';
import { DEFAULT_CURRENCY, createCurrencyPartition } from './money';
import {
  effectiveRevenueCategory,
  payoutShare,
  splitRevenueByPayout,
} from './revenue-mix';
import type {
  RevenueProjection,
  RevenueSeries,
  RevenueSummary,
  TopRevenueContent,
  TopRevenueContentByCurrency,
} from './types/revenue';

/** The fields of a revenue row the summary reads. */
export interface SummaryRevenueRow {
  platform: string | null;
  category: string | null;
  source: string;
  episode_id: string | null;
  amount: CurrencyAmount;
}

/** Inclusive day count of a 'YYYY-MM-DD' range, never less than one. */
export function inclusiveDayCount(startDate: string, endDate: string): number {
  return Math.max(
    1,
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1,
  );
}

export function createRevenueSummaryFold() {
  const parts = createCurrencyPartition(() => ({
    totalRevenueCents: 0,
    previousTotal: 0,
    byPlatform: {} as Record<string, number>,
    byContent: {} as Record<string, number>,
    byType: {} as Record<string, number>,
  }));

  return {
    add(row: SummaryRevenueRow): void {
      const part = parts.for(row.amount.currency);
      const revenueCents = row.amount.cents || 0;

      part.totalRevenueCents += revenueCents;

      const platform = row.platform || 'unknown';
      part.byPlatform[platform] =
        (part.byPlatform[platform] || 0) + revenueCents;

      // Group by revenue category (the mix: ads vs sponsorship vs product).
      // Keyed on what the row counts as rather than what it says: a
      // hand-entered 'ads' row from before the form dropped that option is
      // not evidence of a platform payout, and counting it as one inflates
      // the ad-share signal for every account that has an old row.
      const category = effectiveRevenueCategory(
        row.category || 'ads',
        row.source,
      );
      part.byType[category] = (part.byType[category] || 0) + revenueCents;

      // Channel-level rows have no episode
      if (row.episode_id) {
        part.byContent[row.episode_id] =
          (part.byContent[row.episode_id] || 0) + revenueCents;
      }
    },

    /**
     * A row from the period before, for the trend. A currency seen only
     * there still gets a summary: it earned nothing this period, which is a
     * -100% trend and not an absence.
     */
    addPrevious(amount: CurrencyAmount): void {
      parts.for(amount.currency).previousTotal += amount.cents || 0;
    },

    /**
     * One summary per currency, largest total first. Empty when the account
     * recorded nothing in either period — the caller decides what an empty
     * dashboard shows, this does not invent a currency for it.
     *
     * `totalViews` is the same for every currency: views are not paid in
     * anything. So each RPM is that currency's cents per thousand of *all*
     * views, and the RPMs of two currencies are parts of one rate rather
     * than two measurements of it — `$4.00 + €2.00` per 1,000 views.
     */
    result(context: {
      period: { start: string; end: string };
      totalViews: number;
      /** What `totalViews` pooled; omitted, a record of no platform. */
      denominator?: DenominatorStamp;
    }): RevenueSummary[] {
      const { period, totalViews } = context;
      const rpmDenominator =
        context.denominator ??
        recordViewsDenominator({
          platforms: [],
          window: { from: period.start, to: period.end },
        });
      const dayCount = inclusiveDayCount(period.start, period.end);

      return parts
        .entries((part) => part.totalRevenueCents)
        .map(({ currency, part }) => {
          const { totalRevenueCents, previousTotal, byType } = part;

          // Revenue mix: ads + Premium are platform payouts; everything
          // else is income the channel built itself. The split lives in
          // lib/revenue-mix.ts so that "which side does a new category fall
          // on" is answered by a test.
          const { adsRevenueCents, nonAdRevenueCents } = splitRevenueByPayout(
            byType,
            totalRevenueCents,
          );

          // The denominator the two share fields use: positive buckets only.
          const positiveRevenueCents = Object.values(byType).reduce(
            (sum, cents) => sum + (cents > 0 ? cents : 0),
            0,
          );
          const payoutSharePercent = payoutShare(byType) * 100;

          /** Cents per 1000 views. Display sites divide by 100. */
          const allInRpmCents = rpmCents(totalRevenueCents, totalViews) ?? 0;
          const adsRpmCents = rpmCents(adsRevenueCents, totalViews) ?? 0;

          const trendPercent =
            previousTotal > 0
              ? ((totalRevenueCents - previousTotal) / previousTotal) * 100
              : totalRevenueCents > 0
                ? 100
                : 0;

          return {
            totalRevenueCents,
            currency,
            period,
            byPlatform: part.byPlatform,
            byContent: part.byContent,
            byType,
            rpm: allInRpmCents,
            rpmDenominator,
            totalViews,
            adsRevenueCents,
            nonAdRevenueCents,
            // Over positive buckets, via the shared rule, and computed once.
            //
            // A signed total is not a denominator: `{ ads: 10000,
            // sponsorship: -8000 }` reported adsSharePercent as 500 while
            // the card showed 100 for the same data. Fixing that dropped
            // the old `total > 0` guard, which made an account with no
            // revenue at all report `nonAdSharePercent: 100` — and that
            // figure is persisted into revenue_reports.summary_data, so it
            // is not display-only.
            //
            // positiveRevenueCents travels with them because the cents
            // fields beside these are signed: without the denominator in
            // the payload, a consumer recomputing `adsRevenueCents /
            // totalRevenueCents` gets a different number than the
            // percentage states.
            adsSharePercent: positiveRevenueCents > 0 ? payoutSharePercent : 0,
            nonAdSharePercent:
              positiveRevenueCents > 0 ? 100 - payoutSharePercent : 0,
            positiveRevenueCents,
            adsRpmCents,
            allInRpmCents,
            averageDailyRevenueCents: totalRevenueCents / dayCount,
            trend:
              trendPercent > 5 ? 'up' : trendPercent < -5 ? 'down' : 'stable',
            trendPercent,
          };
        });
    },
  };
}

/** What a tile shows for a currency the summary has nothing in. */
export function zeroRevenueSummary(
  currency: string | null,
  period: { start: string; end: string },
): RevenueSummary {
  const fold = createRevenueSummaryFold();

  fold.addPrevious({ currency, cents: 0 });

  return fold.result({ period, totalViews: 0 })[0]!;
}

/**
 * Daily revenue per currency, zero-filled across the range. One chart per
 * currency: two currencies cannot share an axis without a rate.
 *
 * Never empty — an account with no rows gets one all-zero series in the
 * column's default currency, which is the flat line it always got.
 */
export function createRevenueSeriesFold() {
  const parts = createCurrencyPartition(() => new Map<string, number>());

  return {
    add(row: { record_date: string; amount: CurrencyAmount }): void {
      const byDate = parts.for(row.amount.currency);

      byDate.set(
        row.record_date,
        (byDate.get(row.record_date) ?? 0) + (row.amount.cents || 0),
      );
    },

    result(startDate: string, endDate: string): RevenueSeries[] {
      const dates: string[] = [];
      const currentDate = new Date(startDate);
      const endDateObj = new Date(endDate);

      while (currentDate <= endDateObj) {
        dates.push(currentDate.toISOString().split('T')[0] ?? '');
        currentDate.setDate(currentDate.getDate() + 1);
      }

      const series = parts
        .entries((byDate) =>
          [...byDate.values()].reduce((sum, cents) => sum + cents, 0),
        )
        .map(({ currency, part }) => ({
          currency,
          points: dates.map((date) => ({
            date,
            revenueCents: part.get(date) ?? 0,
          })),
        }));

      return series.length > 0
        ? series
        : [
            {
              currency: DEFAULT_CURRENCY,
              points: dates.map((date) => ({ date, revenueCents: 0 })),
            },
          ];
    },
  };
}

/**
 * The 30-day projection per currency. The days counted, and so the
 * confidence, are the days *that currency* has data for: twenty-five days
 * of AdSense do not make one euro invoice a high-confidence forecast.
 */
export function createRevenueProjectionFold(secondHalfFrom: string) {
  const parts = createCurrencyPartition(() => ({
    totalRecent: 0,
    firstHalfRevenue: 0,
    uniqueDates: new Set<string>(),
  }));

  return {
    add(row: { record_date: string; amount: CurrencyAmount }): void {
      const part = parts.for(row.amount.currency);
      const revenueCents = row.amount.cents || 0;

      part.totalRecent += revenueCents;
      part.uniqueDates.add(row.record_date);

      // First half of the window, for the trend. `YYYY-MM-DD` strings sort
      // as the calendar does, so this compares days rather than instants.
      if (row.record_date < secondHalfFrom) {
        part.firstHalfRevenue += revenueCents;
      }
    },

    result(): RevenueProjection[] {
      return parts
        .entries((part) => part.totalRecent)
        .map(({ currency, part }) => projectionOf(currency, part));
    },
  };
}

/** What the projection tile shows for a currency with no recent rows. */
export function zeroRevenueProjection(
  currency: string | null,
): RevenueProjection {
  return projectionOf(currency, {
    totalRecent: 0,
    firstHalfRevenue: 0,
    uniqueDates: new Set(),
  });
}

function projectionOf(
  currency: string | null,
  part: {
    totalRecent: number;
    firstHalfRevenue: number;
    uniqueDates: Set<string>;
  },
): RevenueProjection {
  const { totalRecent, firstHalfRevenue } = part;
  const daysWithData = part.uniqueDates.size;

  // Calculate daily average
  const dailyAverage = daysWithData > 0 ? totalRecent / daysWithData : 0;

  // Determine confidence level
  let confidenceLevel: 'high' | 'medium' | 'low' = 'low';
  if (daysWithData >= 25) confidenceLevel = 'high';
  else if (daysWithData >= 14) confidenceLevel = 'medium';

  // Calculate trend for impact factor
  const secondHalfRevenue = totalRecent - firstHalfRevenue;
  const trendImpact =
    firstHalfRevenue > 0
      ? Math.round(
          ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 50,
        )
      : 0;

  return {
    currency,
    estimatedMonthlyRevenueCents: Math.round(dailyAverage * 30),
    estimatedYearlyRevenueCents: Math.round(dailyAverage * 365),
    confidenceLevel,
    basedOnDays: daysWithData,
    factors: [
      {
        factor: 'Historical Data',
        impact: daysWithData >= 14 ? 20 : -20,
        description:
          daysWithData >= 14
            ? 'Sufficient data for accurate projection'
            : 'Limited data may affect accuracy',
      },
      {
        factor: 'Trend Direction',
        impact: trendImpact,
        description:
          trendImpact > 0
            ? 'Revenue is trending upward'
            : trendImpact < 0
              ? 'Revenue is trending downward'
              : 'Revenue is stable',
      },
    ],
  };
}

type TopContentDetails = Omit<
  TopRevenueContent,
  'revenueCents' | 'views' | 'rpm' | 'rpmDenominator'
>;

/**
 * Top content per currency. A ranking across currencies orders nothing —
 * is €600 above or below $650? — so each currency ranks its own, and
 * `limit` applies within each.
 */
export function createTopContentFold() {
  const parts = createCurrencyPartition(
    () => new Map<string, TopContentDetails & { revenueCents: number }>(),
  );

  return {
    add(details: TopContentDetails, amount: CurrencyAmount): void {
      const byPublish = parts.for(amount.currency);
      const existing = byPublish.get(details.publishId);

      if (existing) {
        existing.revenueCents += amount.cents || 0;
      } else {
        byPublish.set(details.publishId, {
          ...details,
          revenueCents: amount.cents || 0,
        });
      }
    },

    publishIds(): string[] {
      return [
        ...new Set(
          parts.entries(() => 0).flatMap(({ part }) => [...part.keys()]),
        ),
      ];
    },

    result(
      viewsByPublish: Map<string, number>,
      limit: number,
      /** The days `viewsByPublish` was counted over (FILM-1732). */
      window: DenominatorWindow,
    ): TopRevenueContentByCurrency[] {
      return parts
        .entries((byPublish) =>
          [...byPublish.values()].reduce(
            (sum, item) => sum + item.revenueCents,
            0,
          ),
        )
        .map(({ currency, part }) => ({
          currency,
          items: [...part.values()]
            .map((item) => {
              const views = viewsByPublish.get(item.publishId) ?? 0;

              return {
                ...item,
                views,
                rpm: rpmCents(item.revenueCents, views) ?? 0,
                rpmDenominator: recordViewsDenominator({
                  platforms: [item.platform],
                  window,
                }),
              };
            })
            .sort(
              (a, b) =>
                b.revenueCents - a.revenueCents ||
                a.publishId.localeCompare(b.publishId),
            )
            .slice(0, limit),
        }));
    },
  };
}

/**
 * Which currencies the dashboard draws a row of tiles for.
 *
 * The summary's, because the date range is the question being asked. When
 * the range holds nothing, the projection's — it looks at the last 30 days
 * whatever the range says, and a euro-only account's forecast must not be
 * drawn in dollars. When there is nothing at all, the column's default,
 * which is the `$0` an empty account has always seen.
 */
export function dashboardCurrencies(
  summaries: ReadonlyArray<{ currency: string | null }>,
  projections: ReadonlyArray<{ currency: string | null }>,
): Array<string | null> {
  if (summaries.length > 0) return summaries.map(({ currency }) => currency);
  if (projections.length > 0)
    return projections.map(({ currency }) => currency);

  return [DEFAULT_CURRENCY];
}
