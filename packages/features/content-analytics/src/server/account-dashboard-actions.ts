'use server';

import 'server-only';

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

/**
 * Get dashboard data aggregated across all projects for an account
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
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

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

    // Get all publishes for these projects
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

    // Get current period analytics
    const { data: currentAnalytics } = await client
        .from('content_analytics')
        .select(
            'publish_id, views, likes, comments, shares, saves, revenue_cents, watch_time_seconds, snapshot_date',
        )
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Get previous period analytics
    const { data: previousAnalytics } = await client
        .from('content_analytics')
        .select('publish_id, views, likes, comments, shares, saves, revenue_cents, watch_time_seconds')
        .in('publish_id', publishIds)
        .gte('snapshot_date', previousStartDate.toISOString().split('T')[0])
        .lte('snapshot_date', previousEndDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Calculate totals from current period (latest snapshot per publish)
    const currentTotals = calculateTotals(currentAnalytics || []);
    const previousTotals = calculateTotals(previousAnalytics || []);

    // Platform breakdown
    const platformBreakdown = calculatePlatformBreakdown(
        currentAnalytics || [],
        allPublishes,
    );

    // Daily metrics
    const dailyMetrics = calculateDailyMetrics(currentAnalytics || []);

    // Top content
    const topContent = calculateTopContent(currentAnalytics || [], allPublishes);

    // Production status
    const productionStatus = await getProductionStatus(projectIds);

    return {
        totals: currentTotals,
        previousPeriodTotals: previousTotals,
        dailyMetrics,
        platformBreakdown,
        topContent,
        productionStatus,
        projectCount: projects.length,
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
        productionStatus: { inProgress: 0, finalized: 0, published: 0, scheduled: 0 },
        projectCount: 0,
    };
}

interface AnalyticsRow {
    publish_id: string;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    revenue_cents: number | null;
    watch_time_seconds: number | null;
    snapshot_date?: string;
}

function calculateTotals(analytics: AnalyticsRow[]): AnalyticsTotals {
    // Get latest snapshot per publish
    const latestByPublish = new Map<string, AnalyticsRow>();
    for (const a of analytics) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, a);
        }
    }

    let views = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;
    let revenueCents = 0;
    let watchTimeSeconds = 0;

    for (const a of latestByPublish.values()) {
        views += a.views || 0;
        likes += a.likes || 0;
        comments += a.comments || 0;
        shares += a.shares || 0;
        saves += a.saves || 0;
        revenueCents += a.revenue_cents || 0;
        watchTimeSeconds += a.watch_time_seconds || 0;
    }

    return {
        views,
        likes,
        comments,
        shares,
        saves,
        watchTimeSeconds,
        subscribersGained: 0, // Not tracked per content
        revenueCents,
        contentCount: latestByPublish.size,
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

function calculatePlatformBreakdown(
    analytics: AnalyticsRow[],
    publishes: PublishRow[],
): { platform: string; views: number; percentage: number }[] {
    const publishPlatformMap = new Map<string, string>();
    for (const p of publishes) {
        publishPlatformMap.set(p.id, p.platform);
    }

    // Get latest views per publish
    const latestByPublish = new Map<string, number>();
    for (const a of analytics) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, a.views || 0);
        }
    }

    // Aggregate by platform
    const platformViews = new Map<string, number>();
    let totalViews = 0;

    for (const [publishId, views] of latestByPublish) {
        const platform = publishPlatformMap.get(publishId) || 'unknown';
        platformViews.set(platform, (platformViews.get(platform) || 0) + views);
        totalViews += views;
    }

    return Array.from(platformViews.entries())
        .map(([platform, views]) => ({
            platform,
            views,
            percentage: totalViews > 0 ? (views / totalViews) * 100 : 0,
        }))
        .sort((a, b) => b.views - a.views);
}

function calculateDailyMetrics(analytics: AnalyticsRow[]): DailyMetric[] {
    // Aggregate by date
    const dailyMap = new Map<
        string,
        { views: number; likes: number; comments: number; shares: number }
    >();

    for (const a of analytics) {
        if (!a.snapshot_date) continue;
        const date = a.snapshot_date;
        const current = dailyMap.get(date) || {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
        };
        dailyMap.set(date, {
            views: current.views + (a.views || 0),
            likes: current.likes + (a.likes || 0),
            comments: current.comments + (a.comments || 0),
            shares: current.shares + (a.shares || 0),
        });
    }

    return Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data }));
}

function calculateTopContent(
    analytics: AnalyticsRow[],
    publishes: PublishRow[],
): AccountDashboardData['topContent'] {
    const publishMap = new Map<string, PublishRow>();
    for (const p of publishes) {
        publishMap.set(p.id, p);
    }

    // Get latest stats per publish
    const latestByPublish = new Map<string, AnalyticsRow>();
    for (const a of analytics) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, a);
        }
    }

    // Build top content list
    const contentList: AccountDashboardData['topContent'] = [];
    for (const [publishId, stats] of latestByPublish) {
        const publish = publishMap.get(publishId);
        if (!publish) continue;

        const episode = publish.episodes as PublishRow['episodes'];
        const views = stats.views || 0;
        const likes = stats.likes || 0;
        const comments = stats.comments || 0;
        const shares = stats.shares || 0;
        const engagementRate =
            views > 0 ? ((likes + comments + shares) / views) * 100 : 0;

        contentList.push({
            id: publishId,
            title: publish.title || episode?.title || 'Untitled',
            thumbnailUrl: episode?.thumbnail_url || undefined,
            views,
            likes,
            engagementRate,
            platform: publish.platform,
        });
    }

    // Sort by views and return top 5
    return contentList.sort((a, b) => b.views - a.views).slice(0, 5);
}

async function getProductionStatus(
    projectIds: string[],
): Promise<AccountDashboardData['productionStatus']> {
    const client = getSupabaseServerClient();

    // Get all seasons for these projects
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .in('project_id', projectIds)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) {
        return { inProgress: 0, finalized: 0, published: 0, scheduled: 0 };
    }

    const seasonIds = seasons.map((s) => s.id);

    // Get episode counts by status
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

    // Get scheduled publish count
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
