'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { GetQuickStatsSchema } from '../lib/schemas/dashboard.schema';

export interface QuickStats {
  views: number;
  viewsChange: number;
  followers: number;
  followersChange: number;
  engagementRate: number;
  engagementChange: number;
  publishedCount: number;
}

/**
 * Get quick stats (7-day summary) for an account
 */
export const getQuickStatsAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get current period analytics (last 7 days)
    const { data: currentAnalytics } = await client
      .from('content_analytics')
      .select(
        `
        views,
        likes,
        comments,
        shares,
        subscribers_gained,
        publishes!inner(
          episodes!inner(
            projects!inner(account_id)
          )
        )
      `,
      )
      .gte('snapshot_date', sevenDaysAgo.toISOString().split('T')[0])
      .lte('snapshot_date', now.toISOString().split('T')[0]);

    // Get previous period analytics (7-14 days ago)
    const { data: previousAnalytics } = await client
      .from('content_analytics')
      .select(
        `
        views,
        likes,
        comments,
        shares,
        subscribers_gained,
        publishes!inner(
          episodes!inner(
            projects!inner(account_id)
          )
        )
      `,
      )
      .gte('snapshot_date', fourteenDaysAgo.toISOString().split('T')[0])
      .lt('snapshot_date', sevenDaysAgo.toISOString().split('T')[0]);

    // Get published content count for last 7 days
    const { data: publishedContent } = await client
      .from('publishes')
      .select(
        `
        id,
        episodes!inner(
          projects!inner(account_id)
        )
      `,
      )
      .eq('status', 'published')
      .gte('published_at', sevenDaysAgo.toISOString());

    // Filter by account and aggregate current period
    const currentFiltered = filterByAccount(currentAnalytics, data.accountId);
    const previousFiltered = filterByAccount(previousAnalytics, data.accountId);
    const publishedFiltered = filterPublishesByAccount(
      publishedContent,
      data.accountId,
    );

    const currentStats = aggregateStats(currentFiltered);
    const previousStats = aggregateStats(previousFiltered);

    // Calculate changes
    const viewsChange = calculateChange(
      currentStats.views,
      previousStats.views,
    );
    const followersChange = calculateChange(
      currentStats.subscribers,
      previousStats.subscribers,
    );

    // Calculate engagement rates
    const currentEngagement = calculateEngagementRate(
      currentStats.likes + currentStats.comments + currentStats.shares,
      currentStats.views,
    );
    const previousEngagement = calculateEngagementRate(
      previousStats.likes + previousStats.comments + previousStats.shares,
      previousStats.views,
    );
    const engagementChange = calculateChange(
      currentEngagement,
      previousEngagement,
    );

    return {
      views: currentStats.views,
      viewsChange,
      followers: currentStats.subscribers,
      followersChange,
      engagementRate: currentEngagement,
      engagementChange,
      publishedCount: publishedFiltered.length,
    };
  },
  {
    schema: GetQuickStatsSchema,
  },
);

interface AnalyticsRow {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers_gained: number;
  publishes: {
    episodes: {
      projects: { account_id: string };
    };
  };
}

interface PublishRow {
  id: string;
  episodes: {
    projects: { account_id: string };
  };
}

function filterByAccount(
  data: AnalyticsRow[] | null,
  accountId: string,
): AnalyticsRow[] {
  if (!data) return [];
  return data.filter((row) => {
    const projects = row.publishes?.episodes?.projects as
      | { account_id: string }
      | undefined;
    return projects?.account_id === accountId;
  });
}

function filterPublishesByAccount(
  data: PublishRow[] | null,
  accountId: string,
): PublishRow[] {
  if (!data) return [];
  return data.filter((row) => {
    const projects = row.episodes?.projects as
      | { account_id: string }
      | undefined;
    return projects?.account_id === accountId;
  });
}

function aggregateStats(data: AnalyticsRow[]) {
  return data.reduce(
    (acc, row) => ({
      views: acc.views + (row.views || 0),
      likes: acc.likes + (row.likes || 0),
      comments: acc.comments + (row.comments || 0),
      shares: acc.shares + (row.shares || 0),
      subscribers: acc.subscribers + (row.subscribers_gained || 0),
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, subscribers: 0 },
  );
}

function calculateChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function calculateEngagementRate(engagements: number, views: number): number {
  if (views === 0) return 0;
  return (engagements / views) * 100;
}
