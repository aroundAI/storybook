/**
 * Analytics Aggregation Queries
 *
 * Provides aggregated analytics data for episodes, seasons, and projects.
 * Uses the content_analytics table for historical data.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

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
    totalRevenueCents: number;
    avgWatchTimeSeconds: number;
    engagementRate: number;
    platformBreakdown: {
        platform: string;
        views: number;
        likes: number;
        comments: number;
        shares: number;
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
        .eq('episode_id', episodeId)
        .is('deleted_at', null);

    if (!publishes || publishes.length === 0) {
        return {
            episodeId,
            title: episode.title,
            episodeNumber: episode.number,
            totalViews: 0,
            totalLikes: 0,
            totalComments: 0,
            totalShares: 0,
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
        .select('*')
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
            totalRevenueCents: 0,
            avgWatchTimeSeconds: 0,
            engagementRate: 0,
            platformBreakdown: [],
            dailyTrend: [],
        };
    }

    // Get latest snapshot for each publish (totals)
    const latestByPublish = new Map<string, typeof analytics[0]>();
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
    let totalRevenue = 0;
    let totalWatchTime = 0;

    const platformMap = new Map<
        string,
        { views: number; likes: number; comments: number; shares: number }
    >();

    for (const [publishId, a] of latestByPublish) {
        totalViews += a.views || 0;
        totalLikes += a.likes || 0;
        totalComments += a.comments || 0;
        totalShares += a.shares || 0;
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
            };
            platformMap.set(platform, {
                views: current.views + (a.views || 0),
                likes: current.likes + (a.likes || 0),
                comments: current.comments + (a.comments || 0),
                shares: current.shares + (a.shares || 0),
            });
        }
    }

    // Calculate engagement rate
    const engagementRate =
        totalViews > 0
            ? ((totalLikes + totalComments + totalShares) / totalViews) * 100
            : 0;

    // Build daily trend (last 30 days)
    const dailyMap = new Map<string, { views: number; likes: number; comments: number }>();
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
        totalRevenueCents: totalRevenue,
        avgWatchTimeSeconds: latestByPublish.size > 0 ? totalWatchTime / latestByPublish.size : 0,
        engagementRate,
        platformBreakdown: Array.from(platformMap.entries()).map(([platform, data]) => ({
            platform,
            ...data,
        })),
        dailyTrend,
    };
}

/**
 * Get analytics for a season
 */
export async function getSeasonAnalytics(
    seasonId: string,
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
    let totalRevenue = 0;
    let totalEngagement = 0;

    for (const ep of episodes) {
        const analytics = await getEpisodeAnalytics(ep.id);
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
    const lowestEpisode = sortedByViews.length > 0
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
        totalRevenueCents: totalRevenue,
        avgEngagementRate: episodeAnalytics.length > 0 ? totalEngagement / episodeAnalytics.length : 0,
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
    let totalRevenue = 0;
    let totalEngagement = 0;
    let contentCount = 0;

    const platformTotals = new Map<string, number>();

    for (const s of seasons || []) {
        const analytics = await getSeasonAnalytics(s.id);
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
            totalRevenue += analytics.totalRevenueCents;
            totalEngagement += analytics.avgEngagementRate;
            contentCount += analytics.episodeCount;
        }
    }

    // Get platform breakdown from all publishes
    const { data: allPublishes } = await client
        .from('publishes')
        .select('id, platform, episodes!inner(season_id, seasons!inner(project_id))')
        .eq('episodes.seasons.project_id', projectId)
        .is('deleted_at', null);

    if (allPublishes) {
        const publishIds = allPublishes.map((p) => p.id);
        const { data: analytics } = await client
            .from('content_analytics')
            .select('publish_id, views')
            .in('publish_id', publishIds)
            .order('snapshot_date', { ascending: false });

        if (analytics) {
            const latestByPublish = new Map<string, number>();
            for (const a of analytics) {
                if (!latestByPublish.has(a.publish_id)) {
                    latestByPublish.set(a.publish_id, a.views || 0);
                }
            }

            for (const publish of allPublishes) {
                const views = latestByPublish.get(publish.id) || 0;
                platformTotals.set(
                    publish.platform,
                    (platformTotals.get(publish.platform) || 0) + views,
                );
            }
        }
    }

    const platformTotalsList = Array.from(platformTotals.entries())
        .map(([platform, views]) => ({
            platform,
            views,
            percentage: totalViews > 0 ? (views / totalViews) * 100 : 0,
        }))
        .sort((a, b) => b.views - a.views);

    return {
        projectId,
        projectName: project.name,
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        totalRevenueCents: totalRevenue,
        avgEngagementRate: seasonAnalyticsList.length > 0 ? totalEngagement / seasonAnalyticsList.length : 0,
        contentCount,
        seasons: seasonAnalyticsList,
        platformTotals: platformTotalsList,
    };
}
