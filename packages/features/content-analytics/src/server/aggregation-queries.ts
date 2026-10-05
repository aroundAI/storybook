/**
 * Analytics Aggregation Queries
 *
 * Provides aggregated analytics data for episodes, seasons, and projects.
 * Fetches metadata from Supabase, metrics from ClickHouse.
 */
import 'server-only';

import {
  addMeasured,
  lifetimeWindow,
  poolDenominators,
  recordViewsDenominator,
  recordedEngagementRatePercent,
} from '@kit/clickhouse';
import type {
  AnalyticsPlatform,
  DenominatorWindow,
  RecordedRate,
} from '@kit/clickhouse';
import {
  queryAudienceRows,
  queryDailyTimeSeries,
  queryDailyTimeSeriesByPlatform,
  queryPlatformBreakdown,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import type { AggregatedTotals } from '@kit/clickhouse/server';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { addRevenue } from '../lib/estimated-revenue';
import type { EstimatedRevenue } from '../lib/estimated-revenue';
import { measuredFigure, sumMeasured } from '../lib/export-coverage';
import {
  EMPTY_VIEWS_SCOPE,
  addViews,
  compareViewsDesc,
  mergeViewsScopes,
  viewsScopeOf,
  viewsShare,
  viewsWindowLabel,
} from '../lib/views';
import type { Views, ViewsScope } from '../lib/views';
import type { AnalyticsClient } from './analytics-client';
import { assertProjectAccess } from './scope-access';

/**
 * Episode analytics summary
 */
export interface EpisodeAnalytics {
  episodeId: string;
  title: string;
  episodeNumber: number;
  totalViews: Views;
  /** What `totalViews` covers, for why it is null (KB-166). */
  viewsScope: ViewsScope;
  /** Null where no row was read: not measured, never 0 (KB-192). */
  totalLikes: number | null;
  totalComments: number | null;
  /** Null where no row measured it: no row, or only X's (KB-192, FILM-1727). */
  totalShares: number | null;
  /** Null where no publish measured it: TikTok reports no saves (KB-149). */
  totalSaves: number | null;
  totalRevenueCents: EstimatedRevenue;
  /**
   * Per publish that measured it; null when none did — TikTok reports no
   * watch time, nor does an Instagram post that is not a Reel (KB-149).
   */
  avgWatchTimeSeconds: number | null;
  /** With the views definitions it divided by (FILM-1732). */
  engagementRate: RecordedRate | null;
  platformBreakdown: {
    platform: string;
    views: Views;
    likes: number;
    comments: number;
    shares: number;
    saves: number | null;
  }[];
  dailyTrend: {
    date: string;
    views: Views;
    likes: number;
    comments: number;
  }[];
  /** Null where no publish measured it: only YouTube reports it (KB-149). */
  subscribersGained: number | null;
}

/**
 * Season analytics summary
 */
export interface SeasonAnalytics {
  seasonId: string;
  seasonNumber: number;
  title: string;
  totalViews: Views;
  /** What `totalViews` covers, for why it is null (KB-166). */
  viewsScope: ViewsScope;
  /** Null where no row was read: not measured, never 0 (KB-192). */
  totalLikes: number | null;
  totalComments: number | null;
  /** Null where no row measured it: no row, or only X's (KB-192, FILM-1727). */
  totalShares: number | null;
  /** Null where no publish measured it: TikTok reports no saves (KB-162). */
  totalSaves: number | null;
  totalRevenueCents: EstimatedRevenue;
  /** The mean of the episodes' rates, recorded over all their platforms (FILM-1732). */
  avgEngagementRate: RecordedRate | null;
  episodeCount: number;
  topEpisode: {
    episodeId: string;
    title: string;
    views: Views;
  } | null;
  lowestEpisode: {
    episodeId: string;
    title: string;
    views: Views;
  } | null;
  episodes: {
    episodeId: string;
    title: string;
    episodeNumber: number;
    views: Views;
    engagement: RecordedRate | null;
    revenue: EstimatedRevenue;
  }[];
}

/**
 * Project analytics summary
 */
export interface ProjectAnalytics {
  projectId: string;
  projectName: string;
  totalViews: Views;
  /** What `totalViews` covers, for why it is null (KB-166). */
  viewsScope: ViewsScope;
  /** Null where no row was read: not measured, never 0 (KB-192). */
  totalLikes: number | null;
  totalComments: number | null;
  /** Null where no row measured it: no row, or only X's (KB-192, FILM-1727). */
  totalShares: number | null;
  /** Null where no publish measured it (KB-162). */
  totalSaves: number | null;
  totalRevenueCents: EstimatedRevenue;
  /** The mean of the seasons' rates, recorded over all their platforms (FILM-1732). */
  avgEngagementRate: RecordedRate | null;
  contentCount: number;
  seasons: {
    seasonId: string;
    seasonNumber: number;
    title: string;
    views: Views;
    episodes: number;
    revenue: EstimatedRevenue;
  }[];
  platformTotals: {
    platform: string;
    views: Views;
    likes: number;
    comments: number;
    /** Null where the platform reports no shares: X (FILM-1727). */
    shares: number | null;
    /** Null where none of the platform's rows measured it (KB-162). */
    saves: number | null;
    percentage: number | null;
  }[];
}

/** An episode with no publishes: nothing measured, so no views (KB-167). */
function emptyEpisodeAnalytics(
  episodeId: string,
  title: string,
  episodeNumber: number,
): EpisodeAnalytics {
  return {
    episodeId,
    title,
    episodeNumber,
    totalViews: null,
    viewsScope: EMPTY_VIEWS_SCOPE,
    totalLikes: null,
    totalComments: null,
    totalShares: null,
    totalSaves: null,
    totalRevenueCents: null,
    avgWatchTimeSeconds: null,
    engagementRate: null,
    platformBreakdown: [],
    dailyTrend: [],
    subscribersGained: null,
  };
}

/**
 * The days a read's totals were counted over (FILM-1732): its date filter,
 * and where it has no bound, lifetime totals' — the earliest publish to the
 * day of the read.
 */
function readWindow(
  dateFilters: { startDate?: string; endDate?: string },
  publishes: readonly { published_at?: string | null }[],
): DenominatorWindow {
  const lifetime = lifetimeWindow(
    publishes.map(({ published_at }) => published_at),
  );

  return {
    from: dateFilters.startDate ?? lifetime.from,
    to: dateFilters.endDate ?? lifetime.to,
  };
}

/** The platforms whose publishes have totals in `withRows`. */
function contributingPlatforms(
  publishes: readonly { id: string; platform: string }[],
  withRows: { has: (id: string) => boolean },
): string[] {
  return publishes
    .filter(({ id }) => withRows.has(id))
    .map(({ platform }) => platform);
}

/**
 * The mean of the rates that were measured, recorded over every platform
 * they pooled; null when none was (KB-194). A scope whose rows have no
 * rate is not a rate of 0.
 */
function meanRate(
  rates: readonly (RecordedRate | null)[],
  window: DenominatorWindow,
): RecordedRate | null {
  const measured = rates.flatMap((rate) => (rate ? [rate] : []));

  if (measured.length === 0) return null;

  return {
    value:
      measured.reduce((sum, rate) => sum + rate.value, 0) / measured.length,
    denominator: poolDenominators(
      measured.map((rate) => rate.denominator),
      window,
    ),
  };
}

/**
 * Get analytics for a single episode.
 * Metadata from Supabase, metrics from ClickHouse.
 */
export async function getEpisodeAnalytics(
  episodeId: string,
  dateRange?: { start: Date; end: Date },
  // The caller's client (FILM-1906); the cookie session's when none is given.
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<EpisodeAnalytics | null> {
  // Get episode details
  const { data: episode, error: episodeError } = await client
    .from('episodes')
    // `project_id` so the ClickHouse reads below can be bounded by it.
    // `video_metrics` is ORDER BY (project_id, …), so filtering on
    // `video_id` alone scans the table with FINAL — measured at 733,908
    // rows against 121,317 for the same answer, twice per page load.
    .select('id, title, number, season_id, project_id')
    .eq('id', episodeId)
    .single();

  if (episodeError || !episode) {
    return null;
  }

  // Get all publishes for this episode
  const { data: publishes } = await client
    .from('publishes')
    .select('id, platform, published_at')
    .eq('episode_id', episodeId);

  if (!publishes || publishes.length === 0) {
    return emptyEpisodeAnalytics(episodeId, episode.title, episode.number);
  }

  const publishIds = publishes.map((p) => p.id);
  const dateFilters = dateRange
    ? {
        startDate: dateRange.start.toISOString().split('T')[0],
        endDate: dateRange.end.toISOString().split('T')[0],
      }
    : {};

  // Query ClickHouse — per-publish totals
  const perVideoTotals = await queryTotalsByVideoIds(publishIds, {
    ...dateFilters,
    projectIds: [episode.project_id],
  });

  // Calculate totals. A Facebook publish's views are not measured: it adds
  // nothing, and a total of nothing but Facebook is null (KB-153).
  let totalViews: Views = null;
  // Null until a row is read: no row is not a measured 0 (KB-192).
  let totalLikes: number | null = null;
  let totalComments: number | null = null;
  let totalShares: number | null = null;
  let totalSaves: number | null = null;
  let totalRevenue: EstimatedRevenue = null;
  let totalWatchTime: number | null = null;
  let watchTimePublishes = 0;
  let subscribersGained: number | null = null;

  const platformMap = new Map<
    string,
    {
      views: Views;
      likes: number;
      comments: number;
      shares: number;
      saves: number | null;
    }
  >();

  for (const publish of publishes) {
    const stats = perVideoTotals.get(publish.id);
    if (!stats) continue;

    totalViews = addViews(totalViews, stats.views);
    totalLikes = addMeasured(totalLikes, stats.likes);
    totalComments = addMeasured(totalComments, stats.comments);
    totalShares = addMeasured(totalShares, measuredFigure(stats, 'shares'));
    totalSaves = addMeasured(totalSaves, measuredFigure(stats, 'saves'));
    totalRevenue = addRevenue(totalRevenue, stats.revenue_cents);
    totalWatchTime = addMeasured(
      totalWatchTime,
      measuredFigure(stats, 'watch_time_seconds'),
    );
    if (stats.measured.watch_time_seconds) watchTimePublishes += 1;
    subscribersGained = addMeasured(
      subscribersGained,
      measuredFigure(stats, 'subscribers_gained'),
    );

    const current = platformMap.get(publish.platform) ?? {
      views: null,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: null,
    };
    platformMap.set(publish.platform, {
      views: addViews(current.views, stats.views),
      likes: current.likes + stats.likes,
      comments: current.comments + stats.comments,
      shares: current.shares + stats.shares,
      saves: addMeasured(current.saves, measuredFigure(stats, 'saves')),
    });
  }

  // Daily trend from ClickHouse
  const dailyData = await queryDailyTimeSeries({
    videoIds: publishIds,
    // `projectId`, not `projectIds`: `buildWhereClause` throws when it gets
    // both, so each caller picks the one its query function exposes.
    projectId: episode.project_id,
    ...dateFilters,
  });

  const dailyTrend = dailyData.slice(-30).map((d) => ({
    date: d.date,
    views: d.views,
    likes: d.likes,
    comments: d.comments,
  }));

  const engagementRate = recordedEngagementRatePercent(
    {
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
    },
    recordViewsDenominator({
      platforms: contributingPlatforms(publishes, perVideoTotals),
      window: readWindow(dateFilters, publishes),
    }),
  );

  return {
    episodeId,
    title: episode.title,
    episodeNumber: episode.number,
    totalViews,
    viewsScope: viewsScopeOf(
      publishes,
      perVideoTotals,
      viewsWindowLabel(dateFilters.startDate, dateFilters.endDate),
    ),
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    totalRevenueCents: totalRevenue,
    // Over the publishes that measured it: a TikTok publish in the
    // denominator would read as a video nobody watched (KB-149).
    avgWatchTimeSeconds:
      totalWatchTime === null ? null : totalWatchTime / watchTimePublishes,
    engagementRate,
    platformBreakdown: Array.from(platformMap.entries()).map(
      ([platform, data]) => ({
        platform,
        ...data,
      }),
    ),
    dailyTrend,
    subscribersGained,
  };
}

/**
 * A read narrowed by the page's platform filter (FILM-1709). Absent is
 * every platform; an empty list never gets here — the action's schema
 * refuses it, and the page does not ask.
 */
interface PlatformScopedRead {
  startDate?: Date;
  endDate?: Date;
  platforms?: AnalyticsPlatform[];
}

/**
 * Get analytics for a season.
 *
 * With `platforms`, only those platforms' publishes are read, and an
 * episode counts towards `episodeCount` only if it has one of them: an
 * episode published to TikTok alone is not content on a YouTube-only view.
 */
export async function getSeasonAnalytics(
  seasonId: string,
  options?: PlatformScopedRead,
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<SeasonAnalytics | null> {
  const { data: season, error: seasonError } = await client
    .from('seasons')
    .select('id, number, name')
    .eq('id', seasonId)
    .single();

  if (seasonError || !season) {
    return null;
  }

  const episodes = await fetchAllRows<{
    id: string;
    title: string;
    number: number;
  }>(
    (from, to) =>
      client
        .from('episodes')
        .select('id, title, number')
        .eq('season_id', seasonId)
        .is('deleted_at', null)
        .order('number')
        .order('id')
        .range(from, to),
    'season episodes',
  );

  const dateFilters =
    options?.startDate && options?.endDate
      ? {
          startDate: options.startDate.toISOString().split('T')[0],
          endDate: options.endDate.toISOString().split('T')[0],
        }
      : {};

  if (episodes.length === 0) {
    return {
      seasonId,
      seasonNumber: season.number,
      title: season.name || `Season ${season.number}`,
      // Nothing published: not measured, never 0 (KB-167).
      totalViews: null,
      viewsScope: EMPTY_VIEWS_SCOPE,
      totalLikes: null,
      totalComments: null,
      totalShares: null,
      totalSaves: null,
      totalRevenueCents: null,
      avgEngagementRate: null,
      episodeCount: 0,
      topEpisode: null,
      lowestEpisode: null,
      episodes: [],
    };
  }

  const episodeIds = episodes.map((e) => e.id);

  // Batch: get all publishes for all episodes. Paged — these feed the
  // season totals, which getProjectAnalytics then sums into project totals,
  // so a short read here propagates upward as understated figures.
  const allPublishes = await fetchAllByIds<{
    id: string;
    platform: string;
    episode_id: string;
    published_at: string | null;
  }>(
    episodeIds,
    (chunk, from, to) => {
      let query = client
        .from('publishes')
        .select('id, platform, episode_id, published_at')
        .in('episode_id', chunk);

      // In the query, not on the totals afterwards: a summed total cannot
      // be taken apart by platform again (FILM-1709 §3).
      if (options?.platforms) {
        query = query.in('platform', options.platforms);
      }

      return query.order('id').range(from, to);
    },
    'season publishes',
  );

  if (allPublishes.length === 0 && options?.platforms) {
    return {
      seasonId,
      seasonNumber: season.number,
      title: season.name || `Season ${season.number}`,
      // None of the selected platforms published here: not measured,
      // never 0 (KB-167, KB-192).
      totalViews: null,
      viewsScope: EMPTY_VIEWS_SCOPE,
      totalLikes: null,
      totalComments: null,
      totalShares: null,
      totalSaves: null,
      totalRevenueCents: null,
      avgEngagementRate: null,
      episodeCount: 0,
      topEpisode: null,
      lowestEpisode: null,
      episodes: [],
    };
  }

  if (allPublishes.length === 0) {
    return {
      seasonId,
      seasonNumber: season.number,
      title: season.name || `Season ${season.number}`,
      // Nothing published: not measured, never 0 (KB-167).
      totalViews: null,
      viewsScope: EMPTY_VIEWS_SCOPE,
      totalLikes: null,
      totalComments: null,
      totalShares: null,
      totalSaves: null,
      totalRevenueCents: null,
      avgEngagementRate: null,
      episodeCount: episodes.length,
      topEpisode: null,
      lowestEpisode: null,
      episodes: episodes.map((ep) => ({
        episodeId: ep.id,
        title: ep.title,
        episodeNumber: ep.number,
        views: null,
        engagement: null,
        revenue: null,
      })),
    };
  }

  // Group publishes by episode
  const publishesByEpisode = new Map<string, typeof allPublishes>();
  for (const pub of allPublishes) {
    const existing = publishesByEpisode.get(pub.episode_id) ?? [];
    existing.push(pub);
    publishesByEpisode.set(pub.episode_id, existing);
  }

  // Batch: single ClickHouse query for all publish IDs
  const allPublishIds = allPublishes.map((p) => p.id);
  const perVideoTotals = await queryTotalsByVideoIds(
    allPublishIds,
    dateFilters,
  );

  // Aggregate per episode
  const episodeAnalytics: SeasonAnalytics['episodes'] = [];
  let totalViews: Views = null;
  // Null until a row is read (KB-192).
  let totalLikes: number | null = null;
  let totalComments: number | null = null;
  let totalShares: number | null = null;
  // Each publish's saves, null where unmeasured (KB-162).
  const saves: Array<number | null> = [];
  let totalRevenue: EstimatedRevenue = null;

  const counted = options?.platforms
    ? episodes.filter((ep) => publishesByEpisode.has(ep.id))
    : episodes;

  for (const ep of counted) {
    const epPublishes = publishesByEpisode.get(ep.id) ?? [];
    let epViews: Views = null;
    let epLikes: number | null = null;
    let epComments: number | null = null;
    let epShares: number | null = null;
    let epRevenue: EstimatedRevenue = null;

    for (const pub of epPublishes) {
      const stats = perVideoTotals.get(pub.id);
      if (!stats) continue;
      epViews = addViews(epViews, stats.views);
      epLikes = addMeasured(epLikes, stats.likes);
      epComments = addMeasured(epComments, stats.comments);
      epShares = addMeasured(epShares, measuredFigure(stats, 'shares'));
      saves.push(measuredFigure(stats, 'saves'));
      epRevenue = addRevenue(epRevenue, stats.revenue_cents);
    }

    const epEngagement = recordedEngagementRatePercent(
      {
        views: epViews,
        likes: epLikes,
        comments: epComments,
        shares: epShares,
      },
      recordViewsDenominator({
        platforms: contributingPlatforms(epPublishes, perVideoTotals),
        window: readWindow(dateFilters, epPublishes),
      }),
    );

    episodeAnalytics.push({
      episodeId: ep.id,
      title: ep.title,
      episodeNumber: ep.number,
      views: epViews,
      engagement: epEngagement,
      revenue: epRevenue,
    });

    totalViews = addViews(totalViews, epViews);
    totalLikes = addMeasured(totalLikes, epLikes);
    totalComments = addMeasured(totalComments, epComments);
    totalShares = addMeasured(totalShares, epShares);
    totalRevenue = addRevenue(totalRevenue, epRevenue);
  }

  // Top and lowest are among episodes whose views are measured.
  const sortedByViews = episodeAnalytics
    .filter((episode) => episode.views !== null)
    .sort(compareViewsDesc);
  const topEpisode = sortedByViews[0]
    ? {
        episodeId: sortedByViews[0].episodeId,
        title: sortedByViews[0].title,
        views: sortedByViews[0].views,
      }
    : null;
  const lowestEpisode =
    sortedByViews.length > 0
      ? {
          episodeId: sortedByViews[sortedByViews.length - 1]!.episodeId,
          title: sortedByViews[sortedByViews.length - 1]!.title,
          views: sortedByViews[sortedByViews.length - 1]!.views,
        }
      : null;

  return {
    seasonId,
    seasonNumber: season.number,
    title: season.name || `Season ${season.number}`,
    totalViews,
    viewsScope: viewsScopeOf(
      allPublishes,
      perVideoTotals,
      viewsWindowLabel(dateFilters.startDate, dateFilters.endDate),
    ),
    totalLikes,
    totalComments,
    totalShares,
    totalSaves: sumMeasured(saves).value,
    totalRevenueCents: totalRevenue,
    // Over the episodes whose rates it averages: every platform they pooled.
    avgEngagementRate: meanRate(
      episodeAnalytics.map(({ engagement }) => engagement),
      readWindow(dateFilters, allPublishes),
    ),
    episodeCount: episodeAnalytics.length,
    topEpisode,
    lowestEpisode,
    episodes: episodeAnalytics,
  };
}

/**
 * Get analytics for a project.
 * Uses ClickHouse for platform breakdown via queryPlatformBreakdown.
 */
export async function getProjectAnalytics(
  projectId: string,
  options?: PlatformScopedRead,
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<ProjectAnalytics | null> {
  // Membership, not row visibility: a public project's row is readable by
  // anyone signed in, and the platform breakdown below reads ClickHouse by
  // project id (FILM-1615 EDD, F-0).
  if (!(await canAccessProject(client, projectId))) {
    return null;
  }

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return null;
  }

  const seasons = await fetchAllRows<{
    id: string;
    number: number;
    name: string | null;
  }>(
    (from, to) =>
      client
        .from('seasons')
        .select('id, number, name')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('number')
        .order('id')
        .range(from, to),
    'project seasons',
  );

  const seasonAnalyticsList: ProjectAnalytics['seasons'] = [];
  let totalViews: Views = null;
  // Null until a season reads a row (KB-192).
  let totalLikes: number | null = null;
  let totalComments: number | null = null;
  let totalShares: number | null = null;
  // Each season's saves, null where none was measured (KB-162).
  const seasonSaves: Array<number | null> = [];
  let totalRevenue: EstimatedRevenue = null;
  let contentCount = 0;
  const seasonScopes: ViewsScope[] = [];
  const seasonRates: (RecordedRate | null)[] = [];

  for (const s of seasons || []) {
    const analytics = await getSeasonAnalytics(s.id, options, client);
    if (analytics) {
      seasonScopes.push(analytics.viewsScope);
      seasonAnalyticsList.push({
        seasonId: s.id,
        seasonNumber: s.number,
        title: s.name || `Season ${s.number}`,
        views: analytics.totalViews,
        episodes: analytics.episodeCount,
        revenue: analytics.totalRevenueCents,
      });

      totalViews = addViews(totalViews, analytics.totalViews);
      totalLikes = addMeasured(totalLikes, analytics.totalLikes);
      totalComments = addMeasured(totalComments, analytics.totalComments);
      totalShares = addMeasured(totalShares, analytics.totalShares);
      seasonSaves.push(analytics.totalSaves);
      totalRevenue = addRevenue(totalRevenue, analytics.totalRevenueCents);
      seasonRates.push(analytics.avgEngagementRate);
      contentCount += analytics.episodeCount;
    }
  }

  // Platform breakdown from ClickHouse directly
  const dateFilters: { startDate?: string; endDate?: string } = {};
  if (options?.startDate) {
    dateFilters.startDate = options.startDate.toISOString().split('T')[0];
  }
  if (options?.endDate) {
    dateFilters.endDate = options.endDate.toISOString().split('T')[0];
  }

  const platformData = await queryPlatformBreakdown({
    projectId,
    ...dateFilters,
    ...(options?.platforms ? { platforms: options.platforms } : {}),
  });

  const platformTotalsList = platformData
    .map((p) => ({
      platform: p.platform,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      saves: p.saves,
      percentage: viewsShare(p.views, totalViews),
    }))
    .sort(compareViewsDesc);

  return {
    projectId,
    projectName: project.name,
    totalViews,
    viewsScope: mergeViewsScopes(
      seasonScopes,
      viewsWindowLabel(dateFilters.startDate, dateFilters.endDate),
    ),
    totalLikes,
    totalComments,
    totalShares,
    totalSaves: sumMeasured(seasonSaves).value,
    totalRevenueCents: totalRevenue,
    avgEngagementRate: meanRate(seasonRates, readWindow(dateFilters, [])),
    contentCount,
    seasons: seasonAnalyticsList,
    platformTotals: platformTotalsList,
  };
}

/**
 * Daily metrics for project-level time series chart
 */
export interface ProjectDailyMetric {
  date: string;
  views: Views;
  likes: number;
  comments: number;
  /** The shares of the platforms that report them; X does not (FILM-1727). */
  shares: number;
  byPlatform?: Record<
    string,
    { views: Views; likes: number; comments: number; shares: number | null }
  >;
}

/**
 * Get daily metrics aggregated across all content in a project.
 * Uses ClickHouse queryDailyTimeSeriesByPlatform.
 */
export async function getProjectDailyMetrics(
  projectId: string,
  options?: PlatformScopedRead,
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<ProjectDailyMetric[]> {
  // Verify membership before querying ClickHouse by project id. The row
  // alone is not enough: public projects are readable by any signed-in
  // user (FILM-1615 EDD, F-0).
  if (!(await canAccessProject(client, projectId))) {
    return [];
  }

  const dateFilters: { startDate?: string; endDate?: string } = {};
  if (options?.startDate) {
    dateFilters.startDate = options.startDate.toISOString().split('T')[0];
  }
  if (options?.endDate) {
    dateFilters.endDate = options.endDate.toISOString().split('T')[0];
  }

  return queryDailyTimeSeriesByPlatform({
    projectId,
    ...dateFilters,
    ...(options?.platforms ? { platforms: options.platforms } : {}),
  });
}

/**
 * Audience data aggregated from extra_metrics
 */
export interface ProjectAudienceData {
  demographics?: {
    ageGroups?: Record<string, number>;
    genders?: Record<string, number>;
  };
  geography?: Record<string, number>;
  /**
   * Absent when no video has a device row. Never a zero and never a
   * default: the card this feeds showed `{ mobile: 78, desktop: 18,
   * tablet: 4 }` from a constant for as long as this field did not exist
   * (FILM-1701).
   */
  deviceType?: DeviceTypeBreakdown;
}

/**
 * Views by device, pooled across the project's videos.
 *
 * Only YouTube reports devices, and it reports absolute views, so this is a
 * sum rather than a weighting. `totalViews` is the denominator of every
 * `percentage` here — the views that carried a device, which is not the
 * project's view count.
 */
export interface DeviceTypeBreakdown {
  totalViews: number;
  /** Largest first. `device` is the platform's own value, e.g. `MOBILE`. */
  devices: Array<{ device: string; views: number; percentage: number }>;
}

/**
 * Get aggregated audience data for a project from the video_audience table,
 * weighting per-video percentage breakdowns by each video's view totals.
 */
export async function getProjectAudienceData(
  projectId: string,
  options?: PlatformScopedRead,
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<ProjectAudienceData | null> {
  // Get all publishes for this project. Paged: audience percentages are
  // view-weighted by the per-video totals these ids fetch, so truncation
  // skews the demographic and geographic splits, not just the totals.
  // Narrowed to the selected platforms here, so every split below is
  // over their videos alone (FILM-1709).
  const allPublishes = await fetchAllRows<{ id: string }>((from, to) => {
    let query = client
      .from('publishes')
      .select('id, episodes!inner(project_id)')
      .eq('episodes.project_id', projectId);

    if (options?.platforms) {
      query = query.in('platform', options.platforms);
    }

    return query.order('id').range(from, to);
  }, 'project audience publishes');

  if (allPublishes.length === 0) {
    return null;
  }

  const publishIds = allPublishes.map((p) => p.id);
  const dateFilters: { startDate?: string; endDate?: string } = {};
  if (options?.startDate) {
    dateFilters.startDate = options.startDate.toISOString().split('T')[0];
  }
  if (options?.endDate) {
    dateFilters.endDate = options.endDate.toISOString().split('T')[0];
  }

  // Per-video view totals weight the per-video percentage breakdowns
  const [perVideoTotals, ageRows, genderRows, countryRows, deviceRows] =
    await Promise.all([
      queryTotalsByVideoIds(publishIds, {
        ...dateFilters,
        projectIds: [projectId],
      }),
      queryAudienceRows({
        videoIds: publishIds,
        projectIds: [projectId],
        dimension: 'age_group',
      }),
      queryAudienceRows({
        videoIds: publishIds,
        projectIds: [projectId],
        dimension: 'gender',
      }),
      queryAudienceRows({
        videoIds: publishIds,
        projectIds: [projectId],
        dimension: 'country',
      }),
      queryAudienceRows({
        videoIds: publishIds,
        projectIds: [projectId],
        dimension: 'device',
      }),
    ]);

  const weightFor = (videoId: string) =>
    perVideoTotals.get(videoId)?.views || 1;

  const aggregate = (
    rows: Array<{
      videoId: string;
      key: string;
      views: number;
      percentage: number;
    }>,
  ): Record<string, number> => {
    const totals: Record<string, number> = {};
    let totalWeight = 0;

    for (const row of rows) {
      // Absolute views when the platform reports them, otherwise the
      // video's percentage weighted by its view count.
      const weight =
        row.views > 0
          ? row.views
          : (row.percentage / 100) * weightFor(row.videoId);
      totals[row.key] = (totals[row.key] ?? 0) + weight;
      totalWeight += weight;
    }

    // Out of 100, not 0..1: every card prints this number followed by "%",
    // and a fraction put "0.3%" on screen for a 30% share.
    if (totalWeight > 0) {
      for (const key of Object.keys(totals)) {
        totals[key] = (totals[key]! / totalWeight) * 100;
      }
    }

    return totals;
  };

  const ageGroups = aggregate(ageRows);
  const genders = aggregate(genderRows);
  const geography = aggregate(countryRows);

  const deviceType = poolDeviceViews(deviceRows);

  const hasData =
    Object.keys(ageGroups).length > 0 ||
    Object.keys(genders).length > 0 ||
    Object.keys(geography).length > 0 ||
    deviceType !== undefined;

  if (!hasData) {
    return null;
  }

  return {
    demographics:
      Object.keys(ageGroups).length > 0 || Object.keys(genders).length > 0
        ? {
            ageGroups:
              Object.keys(ageGroups).length > 0 ? ageGroups : undefined,
            genders: Object.keys(genders).length > 0 ? genders : undefined,
          }
        : undefined,
    geography: Object.keys(geography).length > 0 ? geography : undefined,
    ...(deviceType ? { deviceType } : {}),
  };
}

/**
 * Device rows carry absolute views — only YouTube writes them, and
 * `buildAudienceRows` stores no percentage — so the project's split is the
 * sum per device over the sum of all of them. Averaging each video's own
 * shares instead would let a ten-view video move the figure as far as a
 * ten-thousand-view one.
 *
 * Undefined, not an all-zero breakdown, when no row counts a view: a share
 * of nothing is 0/0, and "0%" on every device is a measurement nobody made.
 */
function poolDeviceViews(
  rows: Array<{ key: string; views: number }>,
): DeviceTypeBreakdown | undefined {
  const viewsByDevice = new Map<string, number>();

  for (const row of rows) {
    viewsByDevice.set(row.key, (viewsByDevice.get(row.key) ?? 0) + row.views);
  }

  const totalViews = [...viewsByDevice.values()].reduce(
    (sum, views) => sum + views,
    0,
  );

  if (totalViews === 0) {
    return undefined;
  }

  return {
    totalViews,
    devices: [...viewsByDevice]
      .filter(([, views]) => views > 0)
      .map(([device, views]) => ({
        device,
        views,
        percentage: (views / totalViews) * 100,
      }))
      .sort((a, b) => b.views - a.views || a.device.localeCompare(b.device)),
  };
}

/**
 * Content list item for content table
 */
export interface ContentListItem {
  publishId: string;
  episodeId: string;
  episodeTitle: string;
  publishTitle: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  thumbnailUrl: string | null;
  publishedAt: string;
  /** Null for a Facebook publish: no single view (KB-153). */
  views: Views;
  likes: number;
  comments: number;
  shares: number;
  /** Null where the platform did not measure it: TikTok, YouTube (KB-162). */
  saves: number | null;
  /** Lifetime, so recorded from its publish date to today (FILM-1732). */
  engagementRate: RecordedRate | null;
}

/**
 * Get list of all content for a project with analytics.
 * Metadata from Supabase, metrics from ClickHouse.
 */
export async function getContentList(
  projectId: string,
  options?: PlatformScopedRead,
  client: AnalyticsClient = getSupabaseServerClient(),
): Promise<ContentListItem[]> {
  // Get all publishes for this project through episodes.project_id: an
  // episode need not be in a season (season_id is nullable, KB-48 R9).
  // Paged: the account dashboard reduces this list to a top-N, so a short
  // read silently changes which content is presented as the best.
  const publishes = await fetchAllRows<{
    id: string;
    platform: string;
    title: string | null;
    published_at: string | null;
    episodes: unknown;
  }>((from, to) => {
    let query = client
      .from('publishes')
      .select(
        `
      id,
      platform,
      title,
      published_at,
      episodes!inner (
        id,
        title,
        thumbnail_url,
        project_id
      )
    `,
      )
      .eq('episodes.project_id', projectId)
      .not('published_at', 'is', null);

    if (options?.platforms) {
      query = query.in('platform', options.platforms);
    }
    if (options?.startDate) {
      query = query.gte('published_at', options.startDate.toISOString());
    }
    if (options?.endDate) {
      query = query.lte('published_at', options.endDate.toISOString());
    }

    return query
      .order('published_at', { ascending: false })
      .order('id')
      .range(from, to);
  }, 'project content list');

  if (publishes.length === 0) {
    return [];
  }

  // Get per-publish metrics from ClickHouse
  const publishIds = publishes.map((p) => p.id);
  const latestAnalytics = await queryTotalsByVideoIds(publishIds, {
    projectIds: [projectId],
  });

  // Build content list
  return publishes.map((publish) => {
    const episode = publish.episodes as unknown as {
      id: string;
      title: string;
      thumbnail_url: string | null;
    };
    // No rows yet: views not measured, never 0 (KB-167).
    const stats: AggregatedTotals = latestAnalytics.get(publish.id) ?? {
      views: null,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watch_time_seconds: 0,
      revenue_cents: null,
      subscribers_gained: 0,
    };
    const engagementRate = recordedEngagementRatePercent(
      stats,
      recordViewsDenominator({
        platforms: [publish.platform],
        window: lifetimeWindow([publish.published_at]),
      }),
    );

    return {
      publishId: publish.id,
      episodeId: episode.id,
      episodeTitle: episode.title,
      publishTitle: publish.title || episode.title,
      platform: publish.platform as ContentListItem['platform'],
      thumbnailUrl: episode.thumbnail_url,
      publishedAt: publish.published_at!,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      saves: measuredFigure(latestAnalytics.get(publish.id), 'saves'),
      engagementRate,
    };
  });
}

/**
 * Whether the caller may read a project's analytics. These two readers
 * answer "no access" with an empty result, as they always have, rather
 * than throwing like the scope-checked actions.
 */
async function canAccessProject(
  client: Parameters<typeof assertProjectAccess>[0],
  projectId: string,
): Promise<boolean> {
  try {
    await assertProjectAccess(client, projectId);
    return true;
  } catch {
    return false;
  }
}
