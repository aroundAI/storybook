'use server';

import 'server-only';

import { formatDateStr, queryTotals } from '@kit/clickhouse/server';
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
 * Get quick stats (7-day summary) for an account.
 * Analytics come from ClickHouse; publish metadata from Supabase.
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

      // 1. Get all publish IDs for this account (via Supabase join)
      const { data: accountPublishes, error: pubError } = await client
        .from('publishes')
        .select(
          `
          id,
          episodes!inner(
            projects!inner(account_id)
          )
        `,
        )
        .eq('episodes.projects.account_id', data.accountId);

      if (pubError) {
        throw new Error(
          `Failed to fetch publishes: ${pubError.message}`,
        );
      }

      const videoIds = (accountPublishes ?? []).map((p) => p.id);

      if (videoIds.length === 0) {
        return {
          views: 0,
          viewsChange: 0,
          followers: 0,
          followersChange: 0,
          engagementRate: 0,
          engagementChange: 0,
          publishedCount: 0,
        };
      }

      // 2. Query ClickHouse for current (7 days) and previous (7-14 days) periods

      const [currentTotals, previousTotals] = await Promise.all([
        queryTotals({
          videoIds,
          startDate: formatDateStr(sevenDaysAgo),
          endDate: formatDateStr(now),
        }),
        queryTotals({
          videoIds,
          startDate: formatDateStr(fourteenDaysAgo),
          endDate: formatDateStr(sevenDaysAgo),
        }),
      ]);

      // 3. Get published content count for last 7 days
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

      // 4. Calculate changes
      const viewsChange = calculateChange(
        currentTotals.views,
        previousTotals.views,
      );
      const followersChange = calculateChange(
        currentTotals.subscribers_gained,
        previousTotals.subscribers_gained,
      );

      const currentEngagement = calculateEngagementRate(
        currentTotals.likes + currentTotals.comments + currentTotals.shares,
        currentTotals.views,
      );
      const previousEngagement = calculateEngagementRate(
        previousTotals.likes + previousTotals.comments + previousTotals.shares,
        previousTotals.views,
      );
      const engagementChange = calculateChange(
        currentEngagement,
        previousEngagement,
      );

      return {
        views: currentTotals.views,
        viewsChange,
        followers: currentTotals.subscribers_gained,
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
