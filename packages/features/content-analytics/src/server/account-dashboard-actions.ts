import 'server-only';

import { displayedEngagementRatePercent } from '@kit/clickhouse';
import {
  formatDateStr,
  queryDailyTimeSeries,
  queryPlatformBreakdown,
  queryTotals,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import type { AggregatedTotals } from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { chunkIds, fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
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
    options?.startDate || new Date(endDate.getTime() - THIRTY_DAYS_MS);

  // Previous period for comparison
  const periodDays =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(
    previousEndDate.getTime() - periodDays * 24 * 60 * 60 * 1000,
  );

  // Get all projects for this account. Paged: this is the input every
  // downstream read is scoped by, so truncating it here would leave the
  // dashboard exhaustively paging over an incomplete project set and
  // reporting confidently wrong totals rather than obviously short ones.
  // `projects` has no `deleted_at` — it tracks lifecycle in `status`
  // ('active' | 'archived' | 'deleted'). Filtering on a column that does not
  // exist made PostgREST reject the request, so the dashboard 500'd for every
  // account.
  const projects = await fetchAllRows<{ id: string; name: string }>(
    (from, to) =>
      client
        .from('projects')
        .select('id, name')
        .eq('account_id', accountId)
        .neq('status', 'deleted')
        .order('id')
        .range(from, to),
    'dashboard projects',
  );

  if (projects.length === 0) {
    return getEmptyDashboardData();
  }

  const projectIds = projects.map((p) => p.id);

  // Get all publishes for these projects (metadata from Supabase).
  // Paged and chunked: these ids feed the dashboard's aggregate totals.
  const allPublishes = await fetchAllByIds<PublishRow>(
    projectIds,
    (chunk, from, to) =>
      client
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
        .in('episodes.seasons.project_id', chunk)
        .order('id')
        .range(from, to),
    'dashboard publishes',
  );

  if (allPublishes.length === 0) {
    return {
      ...getEmptyDashboardData(),
      projectCount: projects.length,
      productionStatus: await getProductionStatus(projectIds),
    };
  }

  const publishIds = allPublishes.map((p) => p.id);

  const startDateStr = formatDateStr(startDate);
  const endDateStr = formatDateStr(endDate);
  const prevStartStr = formatDateStr(previousStartDate);
  const prevEndStr = formatDateStr(previousEndDate);

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
  } catch (err) {
    getLogger().then((logger) =>
      logger.warn(
        { err },
        'ClickHouse unavailable, returning empty dashboard data',
      ),
    );
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
    const engagementRate = displayedEngagementRatePercent(stats);

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

  // Paged: the counters below are computed in JS over these rows, so a
  // truncated read reports a smaller production pipeline than exists.
  const seasons = await fetchAllByIds<{ id: string }>(
    projectIds,
    (chunk, from, to) =>
      client
        .from('seasons')
        .select('id')
        .in('project_id', chunk)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    'production seasons',
  );

  if (seasons.length === 0) {
    return { inProgress: 0, finalized: 0, published: 0, scheduled: 0 };
  }

  const seasonIds = seasons.map((s) => s.id);

  const episodes = await fetchAllByIds<{ id: string; status: string }>(
    seasonIds,
    (chunk, from, to) =>
      client
        .from('episodes')
        .select('id, status')
        .in('season_id', chunk)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    'production episodes',
  );

  let inProgress = 0;
  let finalized = 0;
  let published = 0;

  for (const ep of episodes) {
    const status = ep.status;
    if (status === 'draft' || status === 'generating' || status === 'editing') {
      inProgress++;
    } else if (status === 'finalized' || status === 'ready') {
      finalized++;
    } else if (status === 'published') {
      published++;
    }
  }

  const episodeIds = episodes.map((e) => e.id);
  let scheduledCount = 0;

  // An exact head count is not row-capped, so this needs no pagination —
  // but the id list is now unbounded, and a long `.in(...)` is serialized
  // into the URI. Chunk it and sum; the chunks are disjoint by episode.
  for (const chunk of chunkIds(episodeIds)) {
    const { count } = await client
      .from('publishes')
      .select('id', { count: 'exact', head: true })
      .in('episode_id', chunk)
      .gt('scheduled_for', new Date().toISOString())
      .is('published_at', null);
    scheduledCount += count || 0;
  }

  return {
    inProgress,
    finalized,
    published,
    scheduled: scheduledCount,
  };
}
