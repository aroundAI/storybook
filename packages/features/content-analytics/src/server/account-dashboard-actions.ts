'use server';

import 'server-only';

import {
  queryDailyTimeSeries,
  queryPlatformBreakdown,
  queryTotals,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import type { AggregatedTotals } from '@kit/clickhouse/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { AnalyticsTotals, DailyMetric } from '../types';

/**
 * Account-level dashboard data combining all projects
 */
export interface AccountDashboardData {
  totals: AnalyticsTotals;
  previousPeriodTotals: AnalyticsTotals;
  dailyMetrics: DailyMetric[];
  platformBreakdown: {
    platform: string;
    views: number;
    percentage: number;
  }[];
  topContent: {
    id: string;
    title: string;
    thumbnailUrl?: string;
    views: number;
    likes: number;
    engagementRate: number;
    platform: string;
  }[];
  productionStatus: {
    inProgress: number;
    finalized: number;
    published: number;
    scheduled: number;
  };
  projectCount: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Get dashboard data aggregated across all projects for an account.
 * Metadata from Supabase, metrics from ClickHouse.
 */
export async function getAccountDashboardData(
  accountId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<AccountDashboardData> {
  const client = getSupabaseServerClient();

  // Default to last 30 days
  const endDate = options?.endDate || new Date();
  const startDate =
    options?.startDate ||
    new Date(endDate.getTime() - THIRTY_DAYS_MS);

  // Previous period for comparison
  const periodDays =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(
    previousEndDate.getTime() - periodDays * 24 * 60 * 60 * 1000,
  );

  // Get all projects for this account
  const { data: projects } = await client
    .from('projects')
    .select('id, name')
    .eq('account_id', accountId)
    .is('deleted_at', null);

  if (!projects || projects.length === 0) {
    return getEmptyDashboardData();
  }

  const projectIds = projects.map((p) => p.id);

  // Get all publishes for these projects (metadata from Supabase)
  const { data: allPublishes } = await client
    .from('publishes')
    .select(
      `
      id, platform, title, published_at,
      episodes!inner (
        id, title, thumbnail_url,
        seasons!inner (project_id)
      )
    `,
    )
    .in('episodes.seasons.project_id', projectIds);

  if (!allPublishes || allPublishes.length === 0) {
    return {
      ...getEmptyDashboardData(),
      projectCount: projects.length,
      productionStatus: await getProductionStatus(projectIds),
    };
  }

  const publishIds = allPublishes.map((p) => p.id);

  const startDateStr = startDate.toISOString().split('T')[0]!;
  const endDateStr = endDate.toISOString().split('T')[0]!;
  const prevStartStr = previousStartDate.toISOString().split('T')[0]!;
  const prevEndStr = previousEndDate.toISOString().split('T')[0]!;

  // Query ClickHouse for current and previous period
  let currentTotals: AggregatedTotals;
  let previousTotals: AggregatedTotals;
  let platformData: Awaited<ReturnType<typeof queryPlatformBreakdown>>;
  let dailyData: Awaited<ReturnType<typeof queryDailyTimeSeries>>;
  let perVideoTotals: Map<string, AggregatedTotals>;

  try {
    [currentTotals, previousTotals, platformData, dailyData, perVideoTotals] =
      await Promise.all([
        queryTotals({
          videoIds: publishIds,
          startDate: startDateStr,
          endDate: endDateStr,
        }),
        queryTotals({
          videoIds: publishIds,
          startDate: prevStartStr,
          endDate: prevEndStr,
        }),
        queryPlatformBreakdown({
          videoIds: publishIds,
          startDate: startDateStr,
          endDate: endDateStr,
        }),
        queryDailyTimeSeries({
          videoIds: publishIds,
          startDate: startDateStr,
          endDate: endDateStr,
        }),
        queryTotalsByVideoIds(publishIds, {
          startDate: startDateStr,
          endDate: endDateStr,
        }),
      ]);
  } catch {
    // ClickHouse unavailable — return empty dashboard gracefully
    return {
      ...getEmptyDashboardData(),
      projectCount: projects.length,
      productionStatus: await getProductionStatus(projectIds),
    };
  }

  // Map ClickHouse totals to AnalyticsTotals type
  const currentAnalyticsTotals = mapToAnalyticsTotals(
    currentTotals,
    publishIds.length,
  );
  const previousAnalyticsTotals = mapToAnalyticsTotals(previousTotals, 0);

  // Platform breakdown
  const totalViews = currentTotals.views;
  const platformBreakdown = platformData
    .map((p) => ({
      platform: p.platform,
      views: p.views,
      percentage: totalViews > 0 ? (p.views / totalViews) * 100 : 0,
    }))
    .sort((a, b) => b.views - a.views);

  // Daily metrics
  const dailyMetrics: DailyMetric[] = dailyData.map((d) => ({
    date: d.date,
    views: d.views,
    likes: d.likes,
    comments: d.comments,
    shares: d.shares,
  }));

  // Top content (top 5 by views)
  const topContent = buildTopContent(allPublishes, perVideoTotals);

  // Production status (stays Supabase)
  const productionStatus = await getProductionStatus(projectIds);

  return {
    totals: currentAnalyticsTotals,
    previousPeriodTotals: previousAnalyticsTotals,
    dailyMetrics,
    platformBreakdown,
    topContent,
    productionStatus,
    projectCount: projects.length,
  };
}

function mapToAnalyticsTotals(
  ch: AggregatedTotals,
  contentCount: number,
): AnalyticsTotals {
  return {
    views: ch.views,
    likes: ch.likes,
    comments: ch.comments,
    shares: ch.shares,
    saves: ch.saves,
    watchTimeSeconds: ch.watch_time_seconds,
    subscribersGained: ch.subscribers_gained,
    revenueCents: ch.revenue_cents,
    contentCount,
  };
}

function getEmptyDashboardData(): AccountDashboardData {
  return {
    totals: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watchTimeSeconds: 0,
      subscribersGained: 0,
      revenueCents: 0,
      contentCount: 0,
    },
    previousPeriodTotals: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watchTimeSeconds: 0,
      subscribersGained: 0,
      revenueCents: 0,
      contentCount: 0,
    },
    dailyMetrics: [],
    platformBreakdown: [],
    topContent: [],
    productionStatus: {
      inProgress: 0,
      finalized: 0,
      published: 0,
      scheduled: 0,
    },
    projectCount: 0,
  };
}

interface PublishRow {
  id: string;
  platform: string;
  title?: string | null;
  published_at?: string | null;
  episodes?: {
    id: string;
    title: string;
    thumbnail_url?: string | null;
  };
}

function buildTopContent(
  publishes: PublishRow[],
  perVideoTotals: Map<string, AggregatedTotals>,
): AccountDashboardData['topContent'] {
  const contentList: AccountDashboardData['topContent'] = [];

  for (const publish of publishes) {
    const stats = perVideoTotals.get(publish.id);
    if (!stats) continue;

    const episode = publish.episodes as PublishRow['episodes'];
    const engagementRate =
      stats.views > 0
        ? ((stats.likes + stats.comments + stats.shares) / stats.views) * 100
        : 0;

    contentList.push({
      id: publish.id,
      title: publish.title || episode?.title || 'Untitled',
      thumbnailUrl: episode?.thumbnail_url || undefined,
      views: stats.views,
      likes: stats.likes,
      engagementRate,
      platform: publish.platform,
    });
  }

  return contentList.sort((a, b) => b.views - a.views).slice(0, 5);
}

async function getProductionStatus(
  projectIds: string[],
): Promise<AccountDashboardData['productionStatus']> {
  const client = getSupabaseServerClient();

  const { data: seasons } = await client
    .from('seasons')
    .select('id')
    .in('project_id', projectIds)
    .is('deleted_at', null);

  if (!seasons || seasons.length === 0) {
    return { inProgress: 0, finalized: 0, published: 0, scheduled: 0 };
  }

  const seasonIds = seasons.map((s) => s.id);

  const { data: episodes } = await client
    .from('episodes')
    .select('id, status')
    .in('season_id', seasonIds)
    .is('deleted_at', null);

  let inProgress = 0;
  let finalized = 0;
  let published = 0;

  for (const ep of episodes || []) {
    const status = ep.status;
    if (status === 'draft' || status === 'generating' || status === 'editing') {
      inProgress++;
    } else if (status === 'finalized' || status === 'ready') {
      finalized++;
    } else if (status === 'published') {
      published++;
    }
  }

  const episodeIds = (episodes || []).map((e) => e.id);
  let scheduledCount = 0;

  if (episodeIds.length > 0) {
    const { count } = await client
      .from('publishes')
      .select('id', { count: 'exact', head: true })
      .in('episode_id', episodeIds)
      .gt('scheduled_for', new Date().toISOString())
      .is('published_at', null);
    scheduledCount = count || 0;
  }

  return {
    inProgress,
    finalized,
    published,
    scheduled: scheduledCount,
  };
}
