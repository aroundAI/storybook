/**
 * Analytics Aggregation Queries
 *
 * Provides aggregated analytics data for episodes, seasons, and projects.
 * Uses the content_analytics table for historical data.
 */
import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

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

/**
 * Get analytics for a single episode
 */
export async function getEpisodeAnalytics(
  episodeId: string,
  dateRange?: { start: Date; end: Date },
): Promise<EpisodeAnalytics | null> {
  const client = getSupabaseServerClient();

  // Get episode details - episodes table uses 'number' not 'episode_number'
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
    return {
      episodeId,
      title: episode.title,
      episodeNumber: episode.number,
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

  const publishIds = publishes.map((p) => p.id);

  // Build query for analytics
  let analyticsQuery = client
    .from('content_analytics')
    .select(
      'publish_id, views, likes, comments, shares, saves, revenue_cents, watch_time_seconds, snapshot_date',
    )
    .in('publish_id', publishIds);

  if (dateRange) {
    analyticsQuery = analyticsQuery
      .gte('snapshot_date', dateRange.start.toISOString().split('T')[0])
      .lte('snapshot_date', dateRange.end.toISOString().split('T')[0]);
  }

  const { data: analytics } = await analyticsQuery.order('snapshot_date', {
    ascending: false,
  });

  if (!analytics || analytics.length === 0) {
    return {
      episodeId,
      title: episode.title,
      episodeNumber: episode.number,
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

  // Get latest snapshot for each publish (totals)
  const latestByPublish = new Map<string, (typeof analytics)[0]>();
  for (const a of analytics) {
    if (!latestByPublish.has(a.publish_id)) {
      latestByPublish.set(a.publish_id, a);
    }
  }

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

  for (const [publishId, a] of latestByPublish) {
    totalViews += a.views || 0;
    totalLikes += a.likes || 0;
    totalComments += a.comments || 0;
    totalShares += a.shares || 0;
    totalSaves += a.saves || 0;
    totalRevenue += a.revenue_cents || 0;
    totalWatchTime += a.watch_time_seconds || 0;

    // Find platform for this publish
    const publish = publishes.find((p) => p.id === publishId);
    if (publish) {
      const platform = publish.platform;
      const current = platformMap.get(platform) || {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      };
      platformMap.set(platform, {
        views: current.views + (a.views || 0),
        likes: current.likes + (a.likes || 0),
        comments: current.comments + (a.comments || 0),
        shares: current.shares + (a.shares || 0),
        saves: current.saves + (a.saves || 0),
      });
    }
  }

  // Calculate engagement rate
  const engagementRate =
    totalViews > 0
      ? ((totalLikes + totalComments + totalShares) / totalViews) * 100
      : 0;

  // Build daily trend (last 30 days)
  const dailyMap = new Map<
    string,
    { views: number; likes: number; comments: number }
  >();
  for (const a of analytics) {
    const date = a.snapshot_date;
    const current = dailyMap.get(date) || { views: 0, likes: 0, comments: 0 };
    dailyMap.set(date, {
      views: Math.max(current.views, a.views || 0),
      likes: Math.max(current.likes, a.likes || 0),
      comments: Math.max(current.comments, a.comments || 0),
    });
  }

  const dailyTrend = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, data]) => ({ date, ...data }));

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
      latestByPublish.size > 0 ? totalWatchTime / latestByPublish.size : 0,
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

  // Get season details
  // seasons table uses 'number' and 'name' columns
  const { data: season, error: seasonError } = await client
    .from('seasons')
    .select('id, number, name')
    .eq('id', seasonId)
    .single();

  if (seasonError || !season) {
    return null;
  }

  // Get all episodes for this season - episodes table uses 'number' not 'episode_number'
  const { data: episodes } = await client
    .from('episodes')
    .select('id, title, number')
    .eq('season_id', seasonId)
    .is('deleted_at', null)
    .order('number');

  if (!episodes || episodes.length === 0) {
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

  // Get analytics for each episode
  const episodeAnalytics: SeasonAnalytics['episodes'] = [];
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  let totalRevenue = 0;
  let totalEngagement = 0;

  for (const ep of episodes) {
    const dateRange =
      options?.startDate && options?.endDate
        ? { start: options.startDate, end: options.endDate }
        : undefined;
    const analytics = await getEpisodeAnalytics(ep.id, dateRange);
    if (analytics) {
      const epData = {
        episodeId: ep.id,
        title: ep.title,
        episodeNumber: ep.number,
        views: analytics.totalViews,
        engagement: analytics.engagementRate,
        revenue: analytics.totalRevenueCents,
      };
      episodeAnalytics.push(epData);

      totalViews += analytics.totalViews;
      totalLikes += analytics.totalLikes;
      totalComments += analytics.totalComments;
      totalShares += analytics.totalShares;
      totalSaves += analytics.totalSaves;
      totalRevenue += analytics.totalRevenueCents;
      totalEngagement += analytics.engagementRate;
    }
  }

  // Find top and lowest episodes
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
 * Get analytics for a project
 */
export async function getProjectAnalytics(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectAnalytics | null> {
  const client = getSupabaseServerClient();

  // Get project details
  const { data: project, error: projectError } = await client
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return null;
  }

  // Get all seasons for this project
  // seasons table uses 'number' and 'name' columns
  const { data: seasons } = await client
    .from('seasons')
    .select('id, number, name')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('number');

  const seasonAnalyticsList: ProjectAnalytics['seasons'] = [];
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;
  let totalRevenue = 0;
  let totalEngagement = 0;
  let contentCount = 0;

  const platformTotals = new Map<
    string,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      saves: number;
    }
  >();

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

  // Get platform breakdown from all publishes
  const { data: allPublishes } = await client
    .from('publishes')
    .select(
      'id, platform, episodes!inner(season_id, seasons!inner(project_id))',
    )
    .eq('episodes.seasons.project_id', projectId);

  if (allPublishes) {
    const publishIds = allPublishes.map((p) => p.id);
    let analyticsQuery = client
      .from('content_analytics')
      .select(
        'publish_id, views, likes, comments, shares, saves, snapshot_date',
      )
      .in('publish_id', publishIds);

    // Filter by date range if specified
    if (options?.startDate) {
      analyticsQuery = analyticsQuery.gte(
        'snapshot_date',
        options.startDate.toISOString().split('T')[0],
      );
    }
    if (options?.endDate) {
      analyticsQuery = analyticsQuery.lte(
        'snapshot_date',
        options.endDate.toISOString().split('T')[0],
      );
    }

    const { data: analytics } = await analyticsQuery.order('snapshot_date', {
      ascending: false,
    });

    if (analytics) {
      const latestByPublish = new Map<
        string,
        {
          views: number;
          likes: number;
          comments: number;
          shares: number;
          saves: number;
        }
      >();
      for (const a of analytics) {
        if (!latestByPublish.has(a.publish_id)) {
          latestByPublish.set(a.publish_id, {
            views: a.views || 0,
            likes: a.likes || 0,
            comments: a.comments || 0,
            shares: a.shares || 0,
            saves: a.saves || 0,
          });
        }
      }

      for (const publish of allPublishes) {
        const stats = latestByPublish.get(publish.id) || {
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
        };
        const current = platformTotals.get(publish.platform) || {
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
        };
        platformTotals.set(publish.platform, {
          views: current.views + stats.views,
          likes: current.likes + stats.likes,
          comments: current.comments + stats.comments,
          shares: current.shares + stats.shares,
          saves: current.saves + stats.saves,
        });
      }
    }
  }

  const platformTotalsList = Array.from(platformTotals.entries())
    .map(([platform, stats]) => ({
      platform,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      saves: stats.saves,
      percentage: totalViews > 0 ? (stats.views / totalViews) * 100 : 0,
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
 * Get daily metrics aggregated across all content in a project
 */
export async function getProjectDailyMetrics(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectDailyMetric[]> {
  const client = getSupabaseServerClient();

  // Get all publishes for this project through episodes -> seasons
  const { data: allPublishes } = await client
    .from('publishes')
    .select(
      'id, platform, episodes!inner(season_id, seasons!inner(project_id))',
    )
    .eq('episodes.seasons.project_id', projectId);

  if (!allPublishes || allPublishes.length === 0) {
    return [];
  }

  const publishIds = allPublishes.map((p) => p.id);

  // Build publish to platform map
  const publishPlatformMap = new Map<string, string>();
  for (const p of allPublishes) {
    publishPlatformMap.set(p.id, p.platform);
  }

  // Get all analytics records for these publishes
  let analyticsQuery = client
    .from('content_analytics')
    .select('publish_id, snapshot_date, views, likes, comments, shares')
    .in('publish_id', publishIds);

  if (options?.startDate) {
    analyticsQuery = analyticsQuery.gte(
      'snapshot_date',
      options.startDate.toISOString().split('T')[0],
    );
  }
  if (options?.endDate) {
    analyticsQuery = analyticsQuery.lte(
      'snapshot_date',
      options.endDate.toISOString().split('T')[0],
    );
  }

  const { data: analytics } = await analyticsQuery.order('snapshot_date', {
    ascending: true,
  });

  if (!analytics || analytics.length === 0) {
    return [];
  }

  // Aggregate by date
  const dailyMap = new Map<
    string,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      byPlatform: Record<
        string,
        { views: number; likes: number; comments: number; shares: number }
      >;
    }
  >();

  // For each date, get the max values per publish (since metrics are cumulative)
  const datePublishMap = new Map<
    string,
    Map<
      string,
      { views: number; likes: number; comments: number; shares: number }
    >
  >();

  for (const a of analytics) {
    const date = a.snapshot_date;
    if (!datePublishMap.has(date)) {
      datePublishMap.set(date, new Map());
    }
    const publishMap = datePublishMap.get(date)!;
    const existing = publishMap.get(a.publish_id);

    // Take max values for this publish on this date
    publishMap.set(a.publish_id, {
      views: Math.max(existing?.views || 0, a.views || 0),
      likes: Math.max(existing?.likes || 0, a.likes || 0),
      comments: Math.max(existing?.comments || 0, a.comments || 0),
      shares: Math.max(existing?.shares || 0, a.shares || 0),
    });
  }

  // Now aggregate across all publishes for each date
  for (const [date, publishMap] of datePublishMap) {
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    const byPlatform: Record<
      string,
      { views: number; likes: number; comments: number; shares: number }
    > = {};

    for (const [publishId, stats] of publishMap) {
      totalViews += stats.views;
      totalLikes += stats.likes;
      totalComments += stats.comments;
      totalShares += stats.shares;

      const platform = publishPlatformMap.get(publishId) || 'unknown';
      if (!byPlatform[platform]) {
        byPlatform[platform] = { views: 0, likes: 0, comments: 0, shares: 0 };
      }
      byPlatform[platform].views += stats.views;
      byPlatform[platform].likes += stats.likes;
      byPlatform[platform].comments += stats.comments;
      byPlatform[platform].shares += stats.shares;
    }

    dailyMap.set(date, {
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      byPlatform,
    });
  }

  // Convert to sorted array
  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      views: data.views,
      likes: data.likes,
      comments: data.comments,
      shares: data.shares,
      byPlatform: data.byPlatform,
    }));
}

/**
 * Audience data aggregated from content_analytics raw_data
 */
export interface ProjectAudienceData {
  demographics?: {
    ageGroups?: Record<string, number>;
    genders?: Record<string, number>;
  };
  geography?: Record<string, number>;
}

/**
 * Get aggregated audience data for a project
 * Extracts demographics and geography from raw_data JSONB field
 */
export async function getProjectAudienceData(
  projectId: string,
  options?: { startDate?: Date; endDate?: Date },
): Promise<ProjectAudienceData | null> {
  const client = getSupabaseServerClient();

  // Get all publishes for this project
  const { data: allPublishes } = await client
    .from('publishes')
    .select('id, episodes!inner(season_id, seasons!inner(project_id))')
    .eq('episodes.seasons.project_id', projectId);

  if (!allPublishes || allPublishes.length === 0) {
    return null;
  }

  const publishIds = allPublishes.map((p) => p.id);

  // Get latest analytics with raw_data for each publish
  let analyticsQuery = client
    .from('content_analytics')
    .select('publish_id, raw_data, snapshot_date')
    .in('publish_id', publishIds)
    .not('raw_data', 'is', null);

  if (options?.startDate) {
    analyticsQuery = analyticsQuery.gte(
      'snapshot_date',
      options.startDate.toISOString().split('T')[0],
    );
  }
  if (options?.endDate) {
    analyticsQuery = analyticsQuery.lte(
      'snapshot_date',
      options.endDate.toISOString().split('T')[0],
    );
  }

  const { data: analytics } = await analyticsQuery.order('snapshot_date', {
    ascending: false,
  });

  if (!analytics || analytics.length === 0) {
    return null;
  }

  // Get latest raw_data for each publish
  const latestRawData: Record<string, unknown>[] = [];
  const seenPublishes = new Set<string>();

  for (const a of analytics) {
    if (!seenPublishes.has(a.publish_id) && a.raw_data) {
      seenPublishes.add(a.publish_id);
      latestRawData.push(a.raw_data as Record<string, unknown>);
    }
  }

  if (latestRawData.length === 0) {
    return null;
  }

  // Aggregate demographics and geography
  const ageGroups: Record<string, number> = {};
  const genders: Record<string, number> = {};
  const geography: Record<string, number> = {};
  let totalWeight = 0;

  for (const rawData of latestRawData) {
    const demographics = rawData.demographics as
      | { ageGroups?: Record<string, number>; genders?: Record<string, number> }
      | undefined;
    const geo = rawData.geography as Record<string, number> | undefined;
    const views = (rawData.views as number) || 1; // Use views as weight

    if (demographics?.ageGroups) {
      for (const [age, pct] of Object.entries(demographics.ageGroups)) {
        ageGroups[age] = (ageGroups[age] || 0) + pct * views;
      }
    }

    if (demographics?.genders) {
      for (const [gender, pct] of Object.entries(demographics.genders)) {
        genders[gender] = (genders[gender] || 0) + pct * views;
      }
    }

    if (geo) {
      for (const [country, pct] of Object.entries(geo)) {
        geography[country] = (geography[country] || 0) + pct * views;
      }
    }

    totalWeight += views;
  }

  // Normalize to percentages
  if (totalWeight > 0) {
    for (const key of Object.keys(ageGroups)) {
      ageGroups[key] = ageGroups[key]! / totalWeight;
    }
    for (const key of Object.keys(genders)) {
      genders[key] = genders[key]! / totalWeight;
    }
    for (const key of Object.keys(geography)) {
      geography[key] = geography[key]! / totalWeight;
    }
  }

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
 * Get list of all content for a project with analytics
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

  // Get all publishes for this project through episodes -> seasons
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

  // Filter by platforms if specified
  if (options?.platforms && options.platforms.length > 0) {
    query = query.in('platform', options.platforms);
  }

  // Filter by date range if specified
  if (options?.startDate) {
    query = query.gte('published_at', options.startDate.toISOString());
  }
  if (options?.endDate) {
    query = query.lte('published_at', options.endDate.toISOString());
  }

  const { data: publishes, error } = await query.order('published_at', {
    ascending: false,
  });

  if (error || !publishes || publishes.length === 0) {
    return [];
  }

  // Get analytics for each publish
  const publishIds = publishes.map((p) => p.id);
  const { data: analytics } = await client
    .from('content_analytics')
    .select('publish_id, views, likes, comments, shares, saves, snapshot_date')
    .in('publish_id', publishIds)
    .order('snapshot_date', { ascending: false });

  // Get latest analytics per publish
  const latestAnalytics = new Map<
    string,
    {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      saves: number;
    }
  >();
  if (analytics) {
    for (const a of analytics) {
      if (!latestAnalytics.has(a.publish_id)) {
        latestAnalytics.set(a.publish_id, {
          views: a.views || 0,
          likes: a.likes || 0,
          comments: a.comments || 0,
          shares: a.shares || 0,
          saves: a.saves || 0,
        });
      }
    }
  }

  // Build content list
  return publishes.map((publish) => {
    const episode = publish.episodes as unknown as {
      id: string;
      title: string;
      thumbnail_url: string | null;
    };
    const stats = latestAnalytics.get(publish.id) || {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
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
