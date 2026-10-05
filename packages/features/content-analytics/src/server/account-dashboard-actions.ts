import 'server-only';

import {
  recordViewsDenominator,
  recordedEngagementRatePercent,
} from '@kit/clickhouse';
import type { DenominatorWindow, RecordedRate } from '@kit/clickhouse';
import {
  formatDateStr,
  queryDailyTimeSeries,
  queryPlatformBreakdown,
  queryTotals,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import type { AggregatedTotals, ScopeTotals } from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { chunkIds, fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { RevenueAccessNote } from '../lib/revenue-access';
import {
  EMPTY_VIEWS_SCOPE,
  compareViewsDesc,
  viewsScopeOf,
  viewsShare,
} from '../lib/views';
import type { Views, ViewsScope } from '../lib/views';
import type { AnalyticsTotals, DailyMetric, TopContent } from '../types';
import { readAccountRevenueAccess } from './revenue-access-reader';

/** A top item on the dashboard: its engagement rate carries its record (FILM-1732). */
export type AccountTopContent = Omit<TopContent, 'engagementRate'> & {
  engagementRate: RecordedRate | null;
};

/**
 * Account-level dashboard data combining all projects
 */
export interface AccountDashboardData {
  totals: AnalyticsTotals;
  /** What `totals.views` covers, for why it is null (KB-166). */
  viewsScope: ViewsScope;
  /**
   * The total engagement rate with its record (FILM-1732); null when no
   * views were measured. Computed here, where the platforms are known,
   * rather than in the card.
   */
  engagementRate: RecordedRate | null;
  /** Why revenue is not measured, when it is not (FILM-1726). */
  revenueAccess: RevenueAccessNote[];
  previousPeriodTotals: AnalyticsTotals;
  dailyMetrics: DailyMetric[];
  platformBreakdown: {
    platform: string;
    views: Views;
    percentage: number | null;
  }[];
  topContent: AccountTopContent[];
  productionStatus: {
    inProgress: number;
    finalized: number;
    published: number;
    scheduled: number;
  };
  projectCount: number;
}

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccountDashboardInput {
  accountId: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Get dashboard data aggregated across all projects for an account.
 * Metadata from Supabase, metrics from ClickHouse. The cookie-session
 * wrapper over `getAccountDashboardDataService` (FILM-1906).
 */
export async function getAccountDashboardData(
  accountId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<AccountDashboardData> {
  return getAccountDashboardDataService(getSupabaseServerClient(), {
    accountId,
    ...options,
  });
}

/**
 * The account dashboard as a service over the caller's client (FILM-1906).
 *
 * Access is RLS's: projects, publishes, seasons and episodes are read
 * through the client, so an account the caller is not in has no projects
 * here and the dashboard is the empty one. With ClickHouse off, or no
 * answer from it, the figures are null — not measured — never zeros.
 */
export async function getAccountDashboardDataService(
  client: Client,
  { accountId, ...options }: AccountDashboardInput,
): Promise<AccountDashboardData> {
  // A fact about the account's connections, not the window or its
  // projects, so it is read beside the figures rather than from them.
  const [data, revenueAccess] = await Promise.all([
    getAccountFigures(client, accountId, options),
    readRevenueAccessOrNone(client, accountId),
  ]);

  return { ...data, revenueAccess };
}

/**
 * The reasons explain a figure; failing to read them must not cost the
 * dashboard its figures. Without them the card still says Not measured.
 */
async function readRevenueAccessOrNone(
  client: Client,
  accountId: string,
): Promise<RevenueAccessNote[]> {
  try {
    return await readAccountRevenueAccess(client, accountId);
  } catch (err) {
    getLogger().then((logger) =>
      logger.warn({ err, accountId }, 'Revenue access unreadable'),
    );
    return [];
  }
}

async function getAccountFigures(
  client: Client,
  accountId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<Omit<AccountDashboardData, 'revenueAccess'>> {
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
        id, title, thumbnail_url, project_id
      )
    `,
        )
        .in('episodes.project_id', chunk)
        .order('id')
        .range(from, to),
    'dashboard publishes',
  );

  if (allPublishes.length === 0) {
    return {
      ...getEmptyDashboardData(),
      projectCount: projects.length,
      productionStatus: await getProductionStatus(client, projectIds),
    };
  }

  const publishIds = allPublishes.map((p) => p.id);

  const startDateStr = formatDateStr(startDate);
  const endDateStr = formatDateStr(endDate);
  const prevStartStr = formatDateStr(previousStartDate);
  const prevEndStr = formatDateStr(previousEndDate);

  // Query ClickHouse for current and previous period
  let currentTotals: ScopeTotals;
  let previousTotals: ScopeTotals;
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
      productionStatus: await getProductionStatus(client, projectIds),
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
      percentage: viewsShare(p.views, totalViews),
    }))
    .sort(compareViewsDesc);

  // Daily metrics
  const dailyMetrics: DailyMetric[] = dailyData.map((d) => ({
    date: d.date,
    views: d.views,
    likes: d.likes,
    comments: d.comments,
    shares: d.shares,
  }));

  const window = { from: startDateStr, to: endDateStr };
  const engagementRate =
    currentAnalyticsTotals.views === null
      ? null
      : recordedEngagementRatePercent(
          {
            ...currentAnalyticsTotals,
            views: currentAnalyticsTotals.views,
            // An unmeasured count adds none: X's shares (FILM-1727), or
            // none read (KB-192).
            likes: currentAnalyticsTotals.likes ?? 0,
            comments: currentAnalyticsTotals.comments ?? 0,
            shares: currentAnalyticsTotals.shares ?? 0,
          },
          recordViewsDenominator({
            platforms: allPublishes
              .filter(({ id }) => perVideoTotals.has(id))
              .map(({ platform }) => platform),
            window,
          }),
        );

  // Top content (top 5 by views)
  const topContent = buildTopContent(allPublishes, perVideoTotals, window);

  // Production status (stays Supabase)
  const productionStatus = await getProductionStatus(client, projectIds);

  return {
    totals: currentAnalyticsTotals,
    viewsScope: viewsScopeOf(
      allPublishes,
      perVideoTotals,
      options?.startDate || options?.endDate
        ? `${startDateStr} to ${endDateStr}`
        : 'the last 30 days',
    ),
    engagementRate,
    previousPeriodTotals: previousAnalyticsTotals,
    dailyMetrics,
    platformBreakdown,
    topContent,
    productionStatus,
    projectCount: projects.length,
  };
}

function mapToAnalyticsTotals(
  ch: ScopeTotals,
  contentCount: number,
): AnalyticsTotals {
  return {
    views: ch.views,
    likes: ch.likes,
    comments: ch.comments,
    shares: ch.shares,
    // Absent where no row measured it: TikTok reports no saves (KB-162).
    ...(ch.saves !== null && { saves: ch.saves }),
    // Null where no row measured it, never 0 (KB-162).
    watchTimeSeconds: ch.watch_time_seconds,
    subscribersGained: ch.subscribers_gained,
    revenueCents: ch.revenue_cents,
    contentCount,
  };
}

/**
 * No projects, no publishes, or no answer from ClickHouse: nothing was
 * measured, so views and every other count are null, never 0 (KB-167,
 * KB-192), and revenue is Not measured, never $0 (FILM-1726).
 */
function getEmptyDashboardData(): Omit<AccountDashboardData, 'revenueAccess'> {
  return {
    totals: {
      views: null,
      likes: null,
      comments: null,
      shares: null,
      // Nothing measured (KB-162).
      watchTimeSeconds: null,
      subscribersGained: null,
      revenueCents: null,
      contentCount: 0,
    },
    viewsScope: EMPTY_VIEWS_SCOPE,
    engagementRate: null,
    previousPeriodTotals: {
      views: null,
      likes: null,
      comments: null,
      shares: null,
      // Nothing measured (KB-162).
      watchTimeSeconds: null,
      subscribersGained: null,
      revenueCents: null,
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
  window: DenominatorWindow,
): AccountDashboardData['topContent'] {
  const contentList: AccountDashboardData['topContent'] = [];

  for (const publish of publishes) {
    const stats = perVideoTotals.get(publish.id);
    if (!stats) continue;

    const episode = publish.episodes as PublishRow['episodes'];
    // No views, nothing to divide by: not measured, never 0% (KB-153).
    const engagementRate =
      stats.views === null
        ? null
        : recordedEngagementRatePercent(
            { ...stats, views: stats.views },
            recordViewsDenominator({ platforms: [publish.platform], window }),
          );

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

  return contentList.sort(compareViewsDesc).slice(0, 5);
}

async function getProductionStatus(
  client: Client,
  projectIds: string[],
): Promise<AccountDashboardData['productionStatus']> {
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
