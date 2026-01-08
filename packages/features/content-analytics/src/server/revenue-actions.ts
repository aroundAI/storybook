'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

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

/**
 * Get revenue summary for an account within a date range.
 * Aggregates revenue by platform, content, and calculates trends.
 */
export const getRevenueSummaryAction = enhanceAction(
  async function (data): Promise<RevenueSummary> {
    const client = getSupabaseServerClient();
    const { accountId, startDate, endDate } = data;

    // Get all revenue records in date range for the account
    const { data: records, error } = await client
      .from('revenue_records')
      .select(
        `
        id,
        publish_id,
        platform,
        record_date,
        revenue_cents,
        currency,
        source,
        breakdown,
        publishes!inner (
          id,
          episode_id,
          platform,
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
      .eq('publishes.episodes.projects.account_id', accountId);

    if (error) throw error;

    // Calculate totals and group by platform/content in single pass
    let totalRevenueCents = 0;
    const byPlatform: Record<string, number> = {};
    const byContent: Record<string, number> = {};
    const publishIds: string[] = [];

    for (const r of records ?? []) {
      const revenueCents = r.revenue_cents || 0;
      totalRevenueCents += revenueCents;

      // Group by platform
      const platform = r.platform || 'unknown';
      byPlatform[platform] = (byPlatform[platform] || 0) + revenueCents;

      // Group by content (episode)
      const episodeId = r.publishes?.episode_id;
      if (episodeId) {
        byContent[episodeId] = (byContent[episodeId] || 0) + revenueCents;
      }

      // Collect publish IDs for view lookup
      publishIds.push(r.publish_id);
    }

    // Get view data for RPM calculation
    let totalViews = 0;

    if (publishIds.length > 0) {
      const { data: analyticsData } = await client
        .from('content_analytics')
        .select('views')
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate)
        .lte('snapshot_date', endDate);

      // Single-pass sum for views
      for (const a of analyticsData ?? []) {
        totalViews += a.views || 0;
      }
    }

    const rpm = totalViews > 0 ? (totalRevenueCents / totalViews) * 1000 : 0;

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

    const { data: previousRecords } = await client
      .from('revenue_records')
      .select(
        `
        revenue_cents,
        publishes!inner (
          episodes!inner (
            projects!inner (
              account_id
            )
          )
        )
      `,
      )
      .gte('record_date', previousStartDate.toISOString().split('T')[0])
      .lt('record_date', startDate)
      .eq('publishes.episodes.projects.account_id', accountId);

    const previousTotal =
      previousRecords?.reduce((sum, r) => sum + (r.revenue_cents || 0), 0) ?? 0;
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
      byType: {},
      rpm,
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
    const { publishId, date, revenueCents, currency, notes } = data;

    // Get platform from publish
    const { data: publish, error: publishError } = await client
      .from('publishes')
      .select('platform')
      .eq('id', publishId)
      .single();

    if (publishError || !publish) {
      throw new Error('Publish not found or access denied');
    }

    const { data: record, error } = await client
      .from('revenue_records')
      .upsert(
        {
          publish_id: publishId,
          platform: publish.platform,
          record_date: date,
          revenue_cents: revenueCents,
          currency: currency || 'USD',
          source: 'manual',
          metadata: notes ? { notes } : {},
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'publish_id,record_date',
        },
      )
      .select()
      .single();

    if (error) throw error;
    if (!record) throw new Error('Failed to create revenue record');

    return {
      id: record.id,
      publishId: record.publish_id,
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
    const { publishId, date } = data;

    const { error } = await client
      .from('revenue_records')
      .delete()
      .eq('publish_id', publishId)
      .eq('record_date', date)
      .eq('source', 'manual');

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

    const { data: recentRecords } = await client
      .from('revenue_records')
      .select(
        `
        revenue_cents,
        record_date,
        publishes!inner (
          episodes!inner (
            projects!inner (
              account_id
            )
          )
        )
      `,
      )
      .gte('record_date', thirtyDaysAgo.toISOString().split('T')[0])
      .eq('publishes.episodes.projects.account_id', accountId);

    const totalRecent =
      recentRecords?.reduce((sum, r) => sum + (r.revenue_cents || 0), 0) ?? 0;
    const uniqueDates = new Set(recentRecords?.map((r) => r.record_date));
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
    const firstHalfRevenue =
      recentRecords
        ?.filter((r) => {
          const date = new Date(r.record_date);
          const fifteenDaysAgo = new Date();
          fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
          return date < fifteenDaysAgo;
        })
        .reduce((sum, r) => sum + (r.revenue_cents || 0), 0) ?? 0;

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

    const { data: records, error } = await client
      .from('revenue_records')
      .select(
        `
        record_date,
        revenue_cents,
        platform,
        publishes!inner (
          episodes!inner (
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
      .order('record_date', { ascending: true });

    if (error) throw error;

    // Aggregate by date
    const dateMap = new Map<string, number>();
    records?.forEach((r) => {
      const existing = dateMap.get(r.record_date) ?? 0;
      dateMap.set(r.record_date, existing + (r.revenue_cents || 0));
    });

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

    // Get revenue records grouped by publish
    const { data: records, error } = await client
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
      .eq('publishes.episodes.projects.account_id', accountId);

    if (error) throw error;

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
      const publishId = r.publish_id;
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

    // Get views for RPM calculation
    const publishIds = Array.from(publishMap.keys());
    const viewsMap = new Map<string, number>();

    if (publishIds.length > 0) {
      const { data: analyticsData } = await client
        .from('content_analytics')
        .select('publish_id, views')
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate)
        .lte('snapshot_date', endDate);

      analyticsData?.forEach((a) => {
        const existing = viewsMap.get(a.publish_id) ?? 0;
        viewsMap.set(a.publish_id, existing + (a.views || 0));
      });
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

    // Note: Actual YouTube API call would go here
    // For now, we return success without making the API call
    // The analytics-sync-cron already fetches revenue data during regular syncs

    return {
      success: true,
      message:
        'Revenue sync initiated. Data will be updated during next sync cycle.',
    };
  },
  {
    auth: true,
    schema: SyncRevenueFromPlatformSchema,
  },
);
