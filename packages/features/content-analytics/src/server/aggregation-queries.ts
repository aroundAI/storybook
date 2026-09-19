/**
 * Analytics Aggregation Queries
 *
 * Provides aggregated analytics data for episodes, seasons, and projects.
 * Fetches metadata from Supabase, metrics from ClickHouse.
 */
import 'server-only';

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

import { assertProjectAccess } from './scope-access';

/**
 * Episode analytics summary
 */
export interface EpisodeAnalytics {
  episodeId: string;
  title: string;
  episodeNumber: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  totalRevenueCents: number;
  avgWatchTimeSeconds: number;
  engagementRate: number;
  platformBreakdown: {
    platform: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }[];
  dailyTrend: {
    date: string;
    views: number;
    likes: number;
    comments: number;
  }[];
}

/**
 * Season analytics summary
 */
export interface SeasonAnalytics {
  seasonId: string;
  seasonNumber: number;
  title: string;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  totalRevenueCents: number;
  avgEngagementRate: number;
  episodeCount: number;
  topEpisode: {
    episodeId: string;
    title: string;
    views: number;
  } | null;
  lowestEpisode: {
    episodeId: string;
    title: string;
    views: number;
  } | null;
  episodes: {
    episodeId: string;
    title: string;
    episodeNumber: number;
    views: number;
    engagement: number;
    revenue: number;
  }[];
}

/**
 * Project analytics summary
 */
export interface ProjectAnalytics {
  projectId: string;
  projectName: string;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  totalRevenueCents: number;
  avgEngagementRate: number;
  contentCount: number;
  seasons: {
    seasonId: string;
    seasonNumber: number;
    title: string;
    views: number;
    episodes: number;
    revenue: number;
  }[];
  platformTotals: {
    platform: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    percentage: number;
  }[];
}

/** Empty return for zero-data episodes */
function emptyEpisodeAnalytics(
  episodeId: string,
  title: string,
  episodeNumber: number,
): EpisodeAnalytics {
  return {
    episodeId,
    title,
    episodeNumber,
    totalViews: 0,
    totalLikes: 0,
    totalComments: 0,
    totalShares: 0,
    totalSaves: 0,
    totalRevenueCents: 0,
    avgWatchTimeSeconds: 0,
    engagementRate: 0,
    platformBreakdown: [],
    dailyTrend: [],
  };
}

/**
 * Get analytics for a single episode.
 * Metadata from Supabase, metrics from ClickHouse.
 */
export async function getEpisodeAnalytics(
  episodeId: string,
  dateRange?: { start: Date; end: Date },
): Promise<EpisodeAnalytics | null> {
  const client = getSupabaseServerClient();

  // Get episode details
  const { data: episode, error: episodeError } = await client
    .from('episodes')
    .select('id, title, number, season_id')
    .eq('id', episodeId)
    .single();

  if (episodeError || !episode) {
    return null;
  }

  // Get all publishes for this episode
  const { data: publishes } = await client
    .from('publishes')
    .select('id, platform')
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
  const perVideoTotals = await queryTotalsByVideoIds(publishIds, dateFilters);

  // Calculate totals
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  let totalRevenue = 0;
  let totalWatchTime = 0;

  const platformMap = new Map<
    string,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      saves: number;
    }
  >();

  for (const publish of publishes) {
    const stats = perVideoTotals.get(publish.id);
    if (!stats) continue;

    totalViews += stats.views;
    totalLikes += stats.likes;
    totalComments += stats.comments;
    totalShares += stats.shares;
    totalSaves += stats.saves;
    totalRevenue += stats.revenue_cents;
    totalWatchTime += stats.watch_time_seconds;

    const current = platformMap.get(publish.platform) ?? {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
    };
    platformMap.set(publish.platform, {
      views: current.views + stats.views,
      likes: current.likes + stats.likes,
      comments: current.comments + stats.comments,
      shares: current.shares + stats.shares,
      saves: current.saves + stats.saves,
    });
  }

  // Daily trend from ClickHouse
  const dailyData = await queryDailyTimeSeries({
    videoIds: publishIds,
    ...dateFilters,
  });

  const dailyTrend = dailyData.slice(-30).map((d) => ({
    date: d.date,
    views: d.views,
    likes: d.likes,
    comments: d.comments,
  }));

  const engagementRate =
    totalViews > 0
      ? ((totalLikes + totalComments + totalShares) / totalViews) * 100
      : 0;

  return {
    episodeId,
    title: episode.title,
    episodeNumber: episode.number,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    totalRevenueCents: totalRevenue,
    avgWatchTimeSeconds:
      perVideoTotals.size > 0 ? totalWatchTime / perVideoTotals.size : 0,
    engagementRate,
    platformBreakdown: Array.from(platformMap.entries()).map(
      ([platform, data]) => ({
        platform,
        ...data,
      }),
    ),
    dailyTrend,
  };
}

/**
 * Get analytics for a season
 */
export async function getSeasonAnalytics(
  seasonId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<SeasonAnalytics | null> {
  const client = getSupabaseServerClient();

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

  if (episodes.length === 0) {
    return {
      seasonId,
      seasonNumber: season.number,
      title: season.name || `Season ${season.number}`,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      totalRevenueCents: 0,
      avgEngagementRate: 0,
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
  }>(
    episodeIds,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select('id, platform, episode_id')
        .in('episode_id', chunk)
        .order('id')
        .range(from, to),
    'season publishes',
  );

  if (allPublishes.length === 0) {
    return {
      seasonId,
      seasonNumber: season.number,
      title: season.name || `Season ${season.number}`,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      totalRevenueCents: 0,
      avgEngagementRate: 0,
      episodeCount: episodes.length,
      topEpisode: null,
      lowestEpisode: null,
      episodes: episodes.map((ep) => ({
        episodeId: ep.id,
        title: ep.title,
        episodeNumber: ep.number,
        views: 0,
        engagement: 0,
        revenue: 0,
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
  const dateFilters =
    options?.startDate && options?.endDate
      ? {
          startDate: options.startDate.toISOString().split('T')[0],
          endDate: options.endDate.toISOString().split('T')[0],
        }
      : {};

  const perVideoTotals = await queryTotalsByVideoIds(
    allPublishIds,
    dateFilters,
  );

  // Aggregate per episode
  const episodeAnalytics: SeasonAnalytics['episodes'] = [];
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  let totalRevenue = 0;
  let totalEngagement = 0;

  for (const ep of episodes) {
    const epPublishes = publishesByEpisode.get(ep.id) ?? [];
    let epViews = 0;
    let epLikes = 0;
    let epComments = 0;
    let epShares = 0;
    let epSaves = 0;
    let epRevenue = 0;

    for (const pub of epPublishes) {
      const stats = perVideoTotals.get(pub.id);
      if (!stats) continue;
      epViews += stats.views;
      epLikes += stats.likes;
      epComments += stats.comments;
      epShares += stats.shares;
      epSaves += stats.saves;
      epRevenue += stats.revenue_cents;
    }

    const epEngagement =
      epViews > 0 ? ((epLikes + epComments + epShares) / epViews) * 100 : 0;

    episodeAnalytics.push({
      episodeId: ep.id,
      title: ep.title,
      episodeNumber: ep.number,
      views: epViews,
      engagement: epEngagement,
      revenue: epRevenue,
    });

    totalViews += epViews;
    totalLikes += epLikes;
    totalComments += epComments;
    totalShares += epShares;
    totalSaves += epSaves;
    totalRevenue += epRevenue;
    totalEngagement += epEngagement;
  }

  const sortedByViews = [...episodeAnalytics].sort((a, b) => b.views - a.views);
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
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    totalRevenueCents: totalRevenue,
    avgEngagementRate:
      episodeAnalytics.length > 0
        ? totalEngagement / episodeAnalytics.length
        : 0,
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
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectAnalytics | null> {
  const client = getSupabaseServerClient();

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
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  let totalRevenue = 0;
  let totalEngagement = 0;
  let contentCount = 0;

  for (const s of seasons || []) {
    const analytics = await getSeasonAnalytics(s.id, options);
    if (analytics) {
      seasonAnalyticsList.push({
        seasonId: s.id,
        seasonNumber: s.number,
        title: s.name || `Season ${s.number}`,
        views: analytics.totalViews,
        episodes: analytics.episodeCount,
        revenue: analytics.totalRevenueCents,
      });

      totalViews += analytics.totalViews;
      totalLikes += analytics.totalLikes;
      totalComments += analytics.totalComments;
      totalShares += analytics.totalShares;
      totalSaves += analytics.totalSaves;
      totalRevenue += analytics.totalRevenueCents;
      totalEngagement += analytics.avgEngagementRate;
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
  });

  const platformTotalsList = platformData
    .map((p) => ({
      platform: p.platform,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      saves: p.saves,
      percentage: totalViews > 0 ? (p.views / totalViews) * 100 : 0,
    }))
    .sort((a, b) => b.views - a.views);

  return {
    projectId,
    projectName: project.name,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    totalRevenueCents: totalRevenue,
    avgEngagementRate:
      seasonAnalyticsList.length > 0
        ? totalEngagement / seasonAnalyticsList.length
        : 0,
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
  views: number;
  likes: number;
  comments: number;
  shares: number;
  byPlatform?: Record<
    string,
    { views: number; likes: number; comments: number; shares: number }
  >;
}

/**
 * Get daily metrics aggregated across all content in a project.
 * Uses ClickHouse queryDailyTimeSeriesByPlatform.
 */
export async function getProjectDailyMetrics(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectDailyMetric[]> {
  // Verify membership before querying ClickHouse by project id. The row
  // alone is not enough: public projects are readable by any signed-in
  // user (FILM-1615 EDD, F-0).
  const client = getSupabaseServerClient();

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
}

/**
 * Get aggregated audience data for a project from the video_audience table,
 * weighting per-video percentage breakdowns by each video's view totals.
 */
export async function getProjectAudienceData(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectAudienceData | null> {
  const client = getSupabaseServerClient();

  // Get all publishes for this project. Paged: audience percentages are
  // view-weighted by the per-video totals these ids fetch, so truncation
  // skews the demographic and geographic splits, not just the totals.
  const allPublishes = await fetchAllRows<{ id: string }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, episodes!inner(season_id, seasons!inner(project_id))')
        .eq('episodes.seasons.project_id', projectId)
        .order('id')
        .range(from, to),
    'project audience publishes',
  );

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
  const [perVideoTotals, ageRows, genderRows, countryRows] = await Promise.all([
    queryTotalsByVideoIds(publishIds, dateFilters),
    queryAudienceRows({ videoIds: publishIds, dimension: 'age_group' }),
    queryAudienceRows({ videoIds: publishIds, dimension: 'gender' }),
    queryAudienceRows({ videoIds: publishIds, dimension: 'country' }),
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

    if (totalWeight > 0) {
      for (const key of Object.keys(totals)) {
        totals[key] = totals[key]! / totalWeight;
      }
    }

    return totals;
  };

  const ageGroups = aggregate(ageRows);
  const genders = aggregate(genderRows);
  const geography = aggregate(countryRows);

  const hasData =
    Object.keys(ageGroups).length > 0 ||
    Object.keys(genders).length > 0 ||
    Object.keys(geography).length > 0;

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
  platform: 'youtube' | 'tiktok' | 'instagram';
  thumbnailUrl: string | null;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
}

/**
 * Get list of all content for a project with analytics.
 * Metadata from Supabase, metrics from ClickHouse.
 */
export async function getContentList(
  projectId: string,
  options?: {
    platforms?: string[];
    startDate?: Date;
    endDate?: Date;
  },
): Promise<ContentListItem[]> {
  const client = getSupabaseServerClient();

  // Get all publishes for this project through episodes -> seasons.
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
        seasons!inner (
          project_id
        )
      )
    `,
      )
      .eq('episodes.seasons.project_id', projectId)
      .not('published_at', 'is', null);

    if (options?.platforms && options.platforms.length > 0) {
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
  const latestAnalytics = await queryTotalsByVideoIds(publishIds);

  // Build content list
  return publishes.map((publish) => {
    const episode = publish.episodes as unknown as {
      id: string;
      title: string;
      thumbnail_url: string | null;
    };
    const stats: AggregatedTotals = latestAnalytics.get(publish.id) ?? {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watch_time_seconds: 0,
      revenue_cents: 0,
      subscribers_gained: 0,
    };
    const engagementRate =
      stats.views > 0
        ? ((stats.likes + stats.comments + stats.shares) / stats.views) * 100
        : 0;

    return {
      publishId: publish.id,
      episodeId: episode.id,
      episodeTitle: episode.title,
      publishTitle: publish.title || episode.title,
      platform: publish.platform as 'youtube' | 'tiktok' | 'instagram',
      thumbnailUrl: episode.thumbnail_url,
      publishedAt: publish.published_at!,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      saves: stats.saves,
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
