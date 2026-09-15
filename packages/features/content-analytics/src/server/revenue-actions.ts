'use server';

import 'server-only';

import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { payoutShare, splitRevenueByPayout } from '../lib/revenue-mix';
import {
  AddManualRevenueSchema,
  DeleteManualRevenueSchema,
  GenerateRevenueReportSchema,
  GetRevenueProjectionSchema,
  GetRevenueSummarySchema,
  GetRevenueTimeSeriesSchema,
  GetTopContentByRevenueSchema,
  SyncRevenueFromPlatformSchema,
} from '../lib/schemas/revenue.schema';
import type {
  RevenueDataPoint,
  RevenueProjection,
  RevenueRecord,
  RevenueSummary,
  TopRevenueContent,
} from '../lib/types/revenue';
import { forEachAccountRevenueRow } from './revenue-queries';

/**
 * All published publish ids for an account. Used as the RPM denominator so
 * views from content that earned nothing still count — otherwise RPM is
 * computed only over revenue-bearing videos and reads far too high.
 */
async function fetchAccountPublishIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  accountId: string,
): Promise<string[]> {
  // Paged. This is the denominator itself, so a short read inflates every
  // RPM figure — the precise defect this function was added to remove.
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, episodes!inner(projects!inner(account_id))')
        .eq('status', 'published')
        .eq('episodes.projects.account_id', accountId)
        .order('id')
        .range(from, to),
    'account publish ids',
  );

  return rows.map((row) => row.id);
}

export const getRevenueSummaryAction = enhanceAction(
  async function (data): Promise<RevenueSummary> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Both publish-scoped and channel-scoped revenue
    // Calculate totals and group by platform/content/category in single
    // pass, streamed so the window never has to be held in memory.
    let totalRevenueCents = 0;
    const byPlatform: Record<string, number> = {};
    const byContent: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const publishIds: string[] = [];

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (r) => {
        const revenueCents = r.revenue_cents || 0;
        totalRevenueCents += revenueCents;

        // Group by platform
        const platform = r.platform || 'unknown';
        byPlatform[platform] = (byPlatform[platform] || 0) + revenueCents;

        // Group by revenue category (the mix: ads vs sponsorship vs product)
        const category = r.category || 'ads';
        byType[category] = (byType[category] || 0) + revenueCents;

        // Group by content (episode) — channel-level rows have no episode
        if (r.episode_id) {
          byContent[r.episode_id] =
            (byContent[r.episode_id] || 0) + revenueCents;
        }

        if (r.publish_id) {
          publishIds.push(r.publish_id);
        }
      },
    );

    // RPM denominator is every published video's views in the window, not
    // only the ones that earned — otherwise RPM is inflated by excluding
    // content that produced views but no revenue row.
    const denominatorPublishIds = await fetchAccountPublishIds(
      client,
      accountId,
    );

    let totalViews = 0;

    if (denominatorPublishIds.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(
        denominatorPublishIds,
        { startDate, endDate },
      );

      for (const [, stats] of perVideoTotals) {
        totalViews += stats.views;
      }
    }

    // Revenue mix: ads + Premium are platform payouts; everything else is
    // income the channel built itself. A falling ads share is the health
    // signal, so both halves are returned rather than derived downstream.
    //
    // The split lives in lib/revenue-mix.ts so that "which side does a new
    // category fall on" is answered by a test rather than by re-reading
    // this line each time the vocabulary grows.
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

    /** Cents per 1000 views. Display sites divide by 100 for dollars. */
    const allInRpmCents =
      totalViews > 0 ? (totalRevenueCents / totalViews) * 1000 : 0;
    const adsRpmCents =
      totalViews > 0 ? (adsRevenueCents / totalViews) * 1000 : 0;
    const rpm = allInRpmCents;

    // Calculate day count and average
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const dayCount = Math.max(
      1,
      Math.ceil(
        (endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1,
    );
    const averageDailyRevenueCents = totalRevenueCents / dayCount;

    // Calculate trend by comparing to previous period
    const previousStartDate = new Date(startDateObj);
    previousStartDate.setDate(previousStartDate.getDate() - dayCount);

    // Single-pass sum for previous period, streamed.
    let previousTotal = 0;

    await forEachAccountRevenueRow(
      client,
      accountId,
      previousStartDate.toISOString().split('T')[0]!,
      startDate,
      (r) => {
        previousTotal += r.revenue_cents || 0;
      },
      { toExclusive: true },
    );
    const trendPercent =
      previousTotal > 0
        ? ((totalRevenueCents - previousTotal) / previousTotal) * 100
        : totalRevenueCents > 0
          ? 100
          : 0;

    return {
      totalRevenueCents,
      currency: 'USD',
      period: { start: startDate, end: endDate },
      byPlatform,
      byContent,
      byType,
      rpm,
      totalViews,
      adsRevenueCents,
      nonAdRevenueCents,
      // Over positive buckets, via the shared rule, and computed once.
      //
      // A signed total is not a denominator: `{ ads: 10000, sponsorship:
      // -8000 }` reported adsSharePercent as 500 while the card showed 100
      // for the same data. Fixing that dropped the old `total > 0` guard,
      // which made an account with no revenue at all report
      // `nonAdSharePercent: 100` — and that figure is persisted into
      // revenue_reports.summary_data, so it is not display-only.
      //
      // positiveRevenueCents travels with them because the cents fields
      // beside these are signed: without the denominator in the payload, a
      // consumer recomputing `adsRevenueCents / totalRevenueCents` gets a
      // different number than the percentage states.
      adsSharePercent: positiveRevenueCents > 0 ? payoutSharePercent : 0,
      nonAdSharePercent:
        positiveRevenueCents > 0 ? 100 - payoutSharePercent : 0,
      positiveRevenueCents,
      adsRpmCents,
      allInRpmCents,
      averageDailyRevenueCents,
      trend: trendPercent > 5 ? 'up' : trendPercent < -5 ? 'down' : 'stable',
      trendPercent,
    };
  },
  {
    auth: true,
    schema: GetRevenueSummarySchema,
  },
);

/**
 * Add or update a manual revenue entry.
 * Uses upsert to handle both create and update.
 */
export const addManualRevenueAction = enhanceAction(
  async function (data): Promise<RevenueRecord> {
    const client = getSupabaseServerClient();
    const {
      publishId,
      accountId,
      date,
      revenueCents,
      currency,
      category,
      notes,
    } = data;

    // Channel-level revenue (sponsorships, product sales) has no publish
    let platform = 'manual';

    if (publishId) {
      const { data: publish, error: publishError } = await client
        .from('publishes')
        .select('platform')
        .eq('id', publishId)
        .single();

      if (publishError || !publish) {
        throw new Error('Publish not found or access denied');
      }

      platform = publish.platform;
    }

    // The unique index is on coalesce(publish_id, account_id) and cannot be
    // named as an onConflict target, so replace any existing row explicitly.
    const existingQuery = client
      .from('revenue_records')
      .select('id, source')
      .eq('record_date', date)
      .eq('category', category);

    const { data: existing } = await (
      publishId
        ? existingQuery.eq('publish_id', publishId)
        : existingQuery.eq('account_id', accountId!)
    ).maybeSingle();

    // A manual entry replaces a manual entry, never a synced one. The
    // lookup keys on date + category + scope, which is also what the sync
    // writes (`analytics-sync-cron.ts` emits ads/premium/other per publish
    // per day with source 'api'), so without this an entry for a synced
    // publish and date would update that row in place — flipping `source`
    // to manual, leaving the API `breakdown` attached to a hand-typed
    // amount, and putting real platform revenue behind
    // deleteManualRevenueAction, which only ever filters on source.
    //
    // Refused rather than inserted alongside: the unique index is on
    // (coalesce(publish_id, account_id), record_date, category) regardless
    // of source, so a second row is not available to us either way. Saying
    // so is better than a raw constraint violation.
    if (existing && existing.source !== 'manual') {
      throw new Error(
        'Revenue for this date and category was synced from the platform and cannot be overwritten by hand.',
      );
    }

    const values = {
      publish_id: publishId ?? null,
      account_id: accountId ?? null,
      platform,
      record_date: date,
      revenue_cents: revenueCents,
      currency: currency || 'USD',
      source: 'manual' as const,
      category,
      metadata: notes ? { notes } : {},
      updated_at: new Date().toISOString(),
    };

    const { data: record, error } = existing
      ? await client
          .from('revenue_records')
          .update(values)
          .eq('id', existing.id)
          .select()
          .single()
      : await client.from('revenue_records').insert(values).select().single();

    if (error) throw error;
    if (!record) throw new Error('Failed to create revenue record');

    return {
      id: record.id,
      publishId: record.publish_id ?? '',
      platform: record.platform as
        | 'youtube'
        | 'tiktok'
        | 'instagram'
        | 'facebook'
        | 'twitter'
        | 'linkedin'
        | 'manual',
      date: record.record_date,
      revenueCents: record.revenue_cents,
      currency: record.currency ?? 'USD',
      source: record.source as 'api' | 'manual',
      breakdown: record.breakdown as Record<string, number> | undefined,
      metadata: record.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    };
  },
  {
    auth: true,
    schema: AddManualRevenueSchema,
  },
);

/**
 * Delete a manual revenue entry.
 */
export const deleteManualRevenueAction = enhanceAction(
  async function (data): Promise<{ success: boolean }> {
    const client = getSupabaseServerClient();
    const { publishId, accountId, date, category } = data;

    let query = client
      .from('revenue_records')
      .delete()
      .eq('record_date', date)
      .eq('source', 'manual');

    query = publishId
      ? query.eq('publish_id', publishId)
      : query.eq('account_id', accountId!);

    if (category) {
      query = query.eq('category', category);
    }

    const { error } = await query;

    if (error) throw error;

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteManualRevenueSchema,
  },
);

/**
 * Get revenue projection based on historical data.
 * Calculates estimated monthly and yearly revenue with confidence levels.
 */
export const getRevenueProjectionAction = enhanceAction(
  async function (data): Promise<RevenueProjection> {
    const client = getSupabaseServerClient();
    const { accountId } = data;

    // Get last 30 days of revenue
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Single-pass aggregation for total, unique dates, and trend
    // calculation, streamed.
    let totalRecent = 0;
    let firstHalfRevenue = 0;
    const uniqueDates = new Set<string>();
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    await forEachAccountRevenueRow(
      client,
      accountId,
      thirtyDaysAgo.toISOString().split('T')[0]!,
      new Date().toISOString().split('T')[0]!,
      (r) => {
        const revenueCents = r.revenue_cents || 0;
        totalRecent += revenueCents;
        uniqueDates.add(r.record_date);

        // Check if in first half for trend
        const date = new Date(r.record_date);
        if (date < fifteenDaysAgo) {
          firstHalfRevenue += revenueCents;
        }
      },
    );

    const daysWithData = uniqueDates.size;

    // Calculate daily average
    const dailyAverage = daysWithData > 0 ? totalRecent / daysWithData : 0;

    // Project monthly and yearly
    const estimatedMonthlyRevenueCents = Math.round(dailyAverage * 30);
    const estimatedYearlyRevenueCents = Math.round(dailyAverage * 365);

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
      estimatedMonthlyRevenueCents,
      estimatedYearlyRevenueCents,
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
  },
  {
    auth: true,
    schema: GetRevenueProjectionSchema,
  },
);

/**
 * Get revenue time series data for charts.
 */
export const getRevenueTimeSeriesAction = enhanceAction(
  async function (data): Promise<RevenueDataPoint[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Aggregate by date, streamed. The rows were sorted before folding,
    // which a map fold does not need — the series is built from the date
    // range below, in order, regardless of arrival order.
    const dateMap = new Map<string, number>();

    await forEachAccountRevenueRow(
      client,
      accountId,
      startDate,
      endDate,
      (r) => {
        const existing = dateMap.get(r.record_date) ?? 0;
        dateMap.set(r.record_date, existing + (r.revenue_cents || 0));
      },
    );

    // Fill in missing dates with 0
    const result: RevenueDataPoint[] = [];
    const currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
      const dateStr = currentDate.toISOString().split('T')[0] ?? '';
      result.push({
        date: dateStr,
        revenueCents: dateMap.get(dateStr) ?? 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  },
  {
    auth: true,
    schema: GetRevenueTimeSeriesSchema,
  },
);

/**
 * Get top content by revenue.
 */
export const getTopContentByRevenueAction = enhanceAction(
  async function (data): Promise<TopRevenueContent[]> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate, limit } = data;

    // Paged. `limit` is applied after aggregation, so truncation here would
    // not just shorten the list: a publish earning across many dates loses
    // some of them, understating its total and reordering the ranking.
    const records = await fetchAllRows<{
      publish_id: string | null;
      revenue_cents: number | null;
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
          .eq('publishes.episodes.projects.account_id', accountId)
          .order('id')
          .range(from, to),
      'top content by revenue',
    );

    // Aggregate by publish
    const publishMap = new Map<
      string,
      {
        publishId: string;
        episodeId: string;
        title: string;
        platform: string;
        revenueCents: number;
        thumbnailUrl?: string;
      }
    >();

    records?.forEach((r) => {
      // Channel-level revenue has no publish to attribute to
      const publishId = r.publish_id;
      if (!publishId) return;

      const existing = publishMap.get(publishId);
      if (existing) {
        existing.revenueCents += r.revenue_cents || 0;
      } else {
        publishMap.set(publishId, {
          publishId,
          episodeId: r.publishes?.episode_id ?? '',
          title: r.publishes?.episodes?.title ?? 'Untitled',
          platform: r.publishes?.platform ?? 'unknown',
          revenueCents: r.revenue_cents || 0,
          thumbnailUrl: r.publishes?.thumbnail_url ?? undefined,
        });
      }
    });

    // Get views for RPM calculation from ClickHouse
    const publishIds = Array.from(publishMap.keys());
    const viewsMap = new Map<string, number>();

    if (publishIds.length > 0) {
      const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
        startDate,
        endDate,
      });

      for (const [videoId, stats] of perVideoTotals) {
        viewsMap.set(videoId, stats.views);
      }
    }

    // Sort by revenue and return top items
    const sortedContent = Array.from(publishMap.values())
      .map((item) => {
        const views = viewsMap.get(item.publishId) ?? 0;
        return {
          ...item,
          views,
          rpm: views > 0 ? (item.revenueCents / views) * 1000 : 0,
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, limit);

    return sortedContent;
  },
  {
    auth: true,
    schema: GetTopContentByRevenueSchema,
  },
);

/**
 * Generate a revenue report for the given period.
 */
export const generateRevenueReportAction = enhanceAction(
  async function (data) {
    const client = getSupabaseServerClient();
    const { accountId, periodType, startDate, endDate, format } = data;

    // Get summary data
    const summary = await getRevenueSummaryAction({
      accountId,
      startDate,
      endDate,
    });

    // Get top performers
    const topPerformers = await getTopContentByRevenueAction({
      accountId,
      startDate,
      endDate,
      limit: 10,
    });

    // Calculate platform breakdown
    const platformBreakdown = Object.entries(summary.byPlatform).map(
      ([platform, cents]) => ({
        platform,
        revenueCents: cents,
        percentOfTotal:
          summary.totalRevenueCents > 0
            ? (cents / summary.totalRevenueCents) * 100
            : 0,
        contentCount: 0, // Could be calculated if needed
      }),
    );

    // Create report record - cast to Json for JSONB columns
    type Json =
      | string
      | number
      | boolean
      | null
      | { [key: string]: Json | undefined }
      | Json[];

    const { data: report, error } = await client
      .from('revenue_reports')
      .insert({
        account_id: accountId,
        period_type: periodType,
        start_date: startDate,
        end_date: endDate,
        summary_data: JSON.parse(JSON.stringify(summary)) as Json,
        top_performers: JSON.parse(JSON.stringify(topPerformers)) as Json,
        platform_breakdown: JSON.parse(
          JSON.stringify(platformBreakdown),
        ) as Json,
        file_format: format,
      })
      .select()
      .single();

    if (error) throw error;
    if (!report) throw new Error('Failed to create revenue report');

    return {
      id: report.id,
      accountId: report.account_id,
      period: report.period_type,
      startDate: report.start_date,
      endDate: report.end_date,
      summary,
      topPerformers,
      platformBreakdown,
      generatedAt: new Date(report.created_at),
      format,
    };
  },
  {
    auth: true,
    schema: GenerateRevenueReportSchema,
  },
);

/**
 * Sync revenue from platform API for a specific publish.
 * Currently supports YouTube.
 */
export const syncRevenueFromPlatformAction = enhanceAction(
  async function (data) {
    const client = getSupabaseServerClient();
    const { publishId } = data;

    // Get publish details with platform connection
    const { data: publish, error: publishError } = await client
      .from('publishes')
      .select(
        `
        id,
        platform,
        platform_content_id,
        platform_connection_id,
        episodes!inner (
          project_id,
          projects!inner (
            account_id
          )
        )
      `,
      )
      .eq('id', publishId)
      .single();

    if (publishError || !publish) {
      return {
        success: false,
        error: 'Publish not found or access denied',
      };
    }

    // Currently only YouTube supports revenue API
    if (publish.platform !== 'youtube') {
      return {
        success: false,
        error: `Revenue sync not supported for platform: ${publish.platform}`,
      };
    }

    if (!publish.platform_content_id) {
      return {
        success: false,
        error: 'No platform content ID found for this publish',
      };
    }

    // Get platform connection for access token
    if (!publish.platform_connection_id) {
      return {
        success: false,
        error: 'No platform connection found for this publish',
      };
    }

    const { data: connection, error: connectionError } = await client
      .from('platform_connections')
      .select('access_token_encrypted, is_active')
      .eq('id', publish.platform_connection_id)
      .single();

    if (connectionError || !connection) {
      return {
        success: false,
        error: 'Platform connection not found',
      };
    }

    if (!connection.is_active) {
      return {
        success: false,
        error: 'Platform connection is inactive',
      };
    }

    // Run the same sync path the cron uses, which fetches analytics and
    // writes the categorized revenue rows
    const { syncSinglePublishById } = await import('./analytics-sync-cron');
    const result = await syncSinglePublishById(publishId);

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? 'Revenue sync failed',
      };
    }

    return {
      success: true,
      message: 'Revenue synced from the platform.',
    };
  },
  {
    auth: true,
    schema: SyncRevenueFromPlatformSchema,
  },
);
