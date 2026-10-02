import 'server-only';

import type { z } from 'zod';

import { recordViewsDenominator } from '@kit/clickhouse';
import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { fetchAllRows } from '@kit/shared/pagination';

import { addCalendarDays, callerTodayOr } from '../lib/caller-date';
import {
  createRevenueProjectionFold,
  createRevenueSeriesFold,
  createRevenueSummaryFold,
  createTopContentFold,
  inclusiveDayCount,
} from '../lib/revenue-by-currency';
import type {
  GetRevenueProjectionSchema,
  GetRevenueSummarySchema,
  GetRevenueTimeSeriesSchema,
  GetTopContentByRevenueSchema,
} from '../lib/schemas/revenue.schema';
import type {
  RevenueProjection,
  RevenueSeries,
  RevenueSummary,
  TopRevenueContentByCurrency,
} from '../lib/types/revenue';
import { viewsToAdd } from '../lib/views';
import type { AnalyticsClient } from './analytics-client';
import { forEachAccountRevenueRow } from './revenue-queries';

/**
 * The revenue dashboard's reads as services over the caller's client
 * (FILM-1906). Access is RLS's: `revenue_records` and `publishes` are read
 * through the client, so a caller sees only the rows their account policies
 * allow, and an account they are not in reads as empty.
 */

/**
 * All published publish ids for an account. Used as the RPM denominator so
 * views from content that earned nothing still count — otherwise RPM is
 * computed only over revenue-bearing videos and reads far too high.
 */
async function fetchAccountPublishes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
): Promise<{ id: string; platform: string }[]> {
  // Paged. This is the denominator itself, so a short read inflates every
  // RPM figure — the precise defect this function was added to remove.
  const rows = await fetchAllRows<{ id: string; platform: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, platform, episodes!inner(projects!inner(account_id))')
        .eq('status', 'published')
        .eq('episodes.projects.account_id', accountId)
        .order('id')
        .range(from, to),
    'account publish ids',
  );

  return rows.map(({ id, platform }) => ({ id, platform }));
}

export type GetRevenueSummaryInput = z.infer<typeof GetRevenueSummarySchema>;

/**
 * The revenue summary, **one per currency** (KB-12), largest total first.
 *
 * `revenue_records.currency` is a column and there are no exchange rates,
 * so an account paid $12.00 and €5.00 has two totals, two mixes and two
 * RPMs — never 1700 cents of nothing in particular. The arithmetic lives in
 * `createRevenueSummaryFold`, where it is tested without a database. Empty
 * when nothing was recorded in this period or the one before.
 */
export async function getRevenueSummaryService(
  client: AnalyticsClient,
  { accountId, startDate, endDate }: GetRevenueSummaryInput,
): Promise<RevenueSummary[]> {
  // Both publish-scoped and channel-scoped revenue, folded in a single
  // pass and streamed so the window never has to be held in memory.
  const fold = createRevenueSummaryFold();

  await forEachAccountRevenueRow(client, accountId, startDate, endDate, (row) =>
    fold.add(row),
  );

  // RPM denominator is every published video's views in the window, not
  // only the ones that earned — otherwise RPM is inflated by excluding
  // content that produced views but no revenue row.
  const denominatorPublishes = await fetchAccountPublishes(client, accountId);

  let totalViews = 0;
  const pooledPlatforms = new Set<string>();

  if (denominatorPublishes.length > 0) {
    const perVideoTotals = await queryTotalsByVideoIds(
      denominatorPublishes.map(({ id }) => id),
      { startDate, endDate },
    );

    for (const [, stats] of perVideoTotals) {
      totalViews += viewsToAdd(stats.views);
    }

    for (const { id, platform } of denominatorPublishes) {
      if (perVideoTotals.has(id)) pooledPlatforms.add(platform);
    }
  }

  // Trend: the same number of days immediately before, streamed.
  const previousStartDate = new Date(startDate);
  previousStartDate.setDate(
    previousStartDate.getDate() - inclusiveDayCount(startDate, endDate),
  );

  await forEachAccountRevenueRow(
    client,
    accountId,
    previousStartDate.toISOString().split('T')[0]!,
    startDate,
    (row) => fold.addPrevious(row.amount),
    { toExclusive: true },
  );

  return fold.result({
    period: { start: startDate, end: endDate },
    totalViews,
    denominator: recordViewsDenominator({
      platforms: pooledPlatforms,
      window: { from: startDate, to: endDate },
    }),
  });
}

export type GetRevenueProjectionInput = z.infer<
  typeof GetRevenueProjectionSchema
>;

/**
 * Revenue projection based on historical data: estimated monthly and yearly
 * revenue with confidence levels, one projection per currency (KB-12).
 */
export async function getRevenueProjectionService(
  client: AnalyticsClient,
  { accountId, asOf }: GetRevenueProjectionInput,
): Promise<RevenueProjection[]> {
  // The window ends on the caller's own date (KB-24). A manual entry is
  // dated in the browser's calendar; ending at the server's UTC date left
  // a just-saved entry out of the projection from local midnight until
  // UTC's — 00:00 to 05:30 in India. Calendar arithmetic throughout: the
  // trend split used to be "now minus 15 days" as an instant, so which
  // half a day fell in depended on the hour the server ran.
  const end = callerTodayOr(asOf);

  // One projection per currency (KB-12), streamed in a single pass.
  const fold = createRevenueProjectionFold(addCalendarDays(end, -15));

  await forEachAccountRevenueRow(
    client,
    accountId,
    addCalendarDays(end, -30),
    end,
    (row) => fold.add(row),
  );

  return fold.result();
}

export type GetRevenueTimeSeriesInput = z.infer<
  typeof GetRevenueTimeSeriesSchema
>;

/** Revenue time series data for charts, one series per currency (KB-12). */
export async function getRevenueTimeSeriesService(
  client: AnalyticsClient,
  { accountId, startDate, endDate }: GetRevenueTimeSeriesInput,
): Promise<RevenueSeries[]> {
  // One series per currency (KB-12): two currencies cannot share an axis
  // without a rate. Streamed; the fold zero-fills the range in order,
  // whatever order the rows arrive in.
  const fold = createRevenueSeriesFold();

  await forEachAccountRevenueRow(client, accountId, startDate, endDate, (row) =>
    fold.add(row),
  );

  return fold.result(startDate, endDate);
}

export type GetTopContentByRevenueInput = z.infer<
  typeof GetTopContentByRevenueSchema
>;

/** Top content by revenue, ranked within each currency (KB-12). */
export async function getTopContentByRevenueService(
  client: AnalyticsClient,
  { accountId, startDate, endDate, limit }: GetTopContentByRevenueInput,
): Promise<TopRevenueContentByCurrency[]> {
  // Paged. `limit` is applied after aggregation, so truncation here would
  // not just shorten the list: a publish earning across many dates loses
  // some of them, understating its total and reordering the ranking.
  const records = await fetchAllRows<{
    publish_id: string | null;
    revenue_cents: number | null;
    currency: string | null;
    platform: string | null;
    publishes?: {
      episode_id?: string | null;
      platform?: string | null;
      thumbnail_url?: string | null;
      episodes?: { title?: string | null } | null;
    } | null;
  }>(
    (from, to) =>
      client
        .from('revenue_records')
        .select(
          `
        publish_id,
        revenue_cents,
        currency,
        platform,
        publishes!inner (
          id,
          episode_id,
          platform,
          thumbnail_url,
          episodes!inner (
            id,
            title,
            project_id,
            projects!inner (
              account_id
            )
          )
        )
      `,
        )
        .gte('record_date', startDate)
        .lte('record_date', endDate)
        // Not measured is not revenue (FILM-1726).
        .not('revenue_cents', 'is', null)
        .eq('publishes.episodes.projects.account_id', accountId)
        .order('id')
        .range(from, to),
    'top content by revenue',
  );

  // Aggregate by publish, within a currency (KB-12): a ranking across
  // currencies orders nothing, so each currency ranks its own.
  const fold = createTopContentFold();

  for (const r of records) {
    // Channel-level revenue has no publish to attribute to
    if (!r.publish_id) continue;

    fold.add(
      {
        publishId: r.publish_id,
        episodeId: r.publishes?.episode_id ?? '',
        title: r.publishes?.episodes?.title ?? 'Untitled',
        platform: r.publishes?.platform ?? 'unknown',
        thumbnailUrl: r.publishes?.thumbnail_url ?? undefined,
      },
      { currency: r.currency, cents: r.revenue_cents || 0 },
    );
  }

  // Get views for RPM calculation from ClickHouse
  const publishIds = fold.publishIds();
  const viewsMap = new Map<string, number>();

  if (publishIds.length > 0) {
    const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
      startDate,
      endDate,
    });

    // A Facebook video has no views to divide by: no RPM (KB-153).
    for (const [videoId, stats] of perVideoTotals) {
      if (stats.views !== null) viewsMap.set(videoId, stats.views);
    }
  }

  return fold.result(viewsMap, limit, { from: startDate, to: endDate });
}
