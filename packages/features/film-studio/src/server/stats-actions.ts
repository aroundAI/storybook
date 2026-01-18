'use server';

import 'server-only';

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

interface AnalyticsRow {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers_gained: number;
  publishes: unknown;
}

/**
 * Get quick stats (7-day summary) for an account
 */
export const getQuickStatsAction = enhanceAction(
  async (data) => {
    try {
      const client = getSupabaseServerClient();

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(
        now.getTime() - 14 * 24 * 60 * 60 * 1000,
      );

      // Get current period analytics (last 7 days) - filtered by account at SQL level
      const { data: currentAnalytics, error: currentError } = await client
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
        .eq('publishes.episodes.projects.account_id', data.accountId)
        .gte('snapshot_date', sevenDaysAgo.toISOString().split('T')[0])
        .lte('snapshot_date', now.toISOString().split('T')[0]);

      if (currentError) {
        throw new Error(
          `Failed to fetch current analytics: ${currentError.message}`,
        );
      }

      // Get previous period analytics (7-14 days ago) - filtered by account at SQL level
      const { data: previousAnalytics, error: previousError } = await client
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
        .eq('publishes.episodes.projects.account_id', data.accountId)
        .gte('snapshot_date', fourteenDaysAgo.toISOString().split('T')[0])
        .lt('snapshot_date', sevenDaysAgo.toISOString().split('T')[0]);

      if (previousError) {
        throw new Error(
          `Failed to fetch previous analytics: ${previousError.message}`,
        );
      }

      // Get published content count for last 7 days - filtered by account at SQL level
      const { data: publishedContent, error: publishedError } = await client
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
        .eq('episodes.projects.account_id', data.accountId)
        .gte('published_at', sevenDaysAgo.toISOString());

      if (publishedError) {
        throw new Error(
          `Failed to fetch published content: ${publishedError.message}`,
        );
      }

      // Aggregate stats directly - SQL already filtered by account
      const currentStats = aggregateStats(currentAnalytics as AnalyticsRow[] | null);
      const previousStats = aggregateStats(previousAnalytics as AnalyticsRow[] | null);

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
        publishedCount: (publishedContent ?? []).length,
      };
    } catch (error) {
      console.error('Error fetching quick stats:', error);
      throw error;
    }
  },
  {
    schema: GetQuickStatsSchema,
  },
);

// Note: filterByAccount and filterPublishesByAccount functions were removed
// SQL filters now handle account-level filtering at database level

function aggregateStats(data: AnalyticsRow[] | null) {
  if (!data) return { views: 0, likes: 0, comments: 0, shares: 0, subscribers: 0 };
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
