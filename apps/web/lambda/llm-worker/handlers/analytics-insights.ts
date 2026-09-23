/**
 * Analytics Insights Handler
 *
 * Generates AI-powered analytics insights.
 * No database writes - returns insights to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface AnalyticsInsightsPayload {
  projectId: string;
  analytics: {
    totals: {
      views: number;
      likes: number;
      comments: number;
      shares: number;
      watchTimeSeconds: number;
      subscribersGained: number;
      revenueCents: number;
      contentCount: number;
    };
    previousPeriodTotals?: Record<string, number>;
    platformMetrics?: Array<{
      platform: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
    }>;
    topContent?: Array<{
      id: string;
      title: string;
      views: number;
      likes: number;
      engagementRate: number;
      platform: string;
    }>;
    audience?: Record<string, unknown>;
    contentCount: number;
    avgEngagementRate: number;
  };
  userId: string;
}

interface InsightsResult {
  success: boolean;
  data: {
    summary: string;
    trends: string[];
    contentRecommendations: string[];
    postingStrategy: string[];
    audienceInsights: string[];
    topPerformers: string[];
    actionItems: string[];
  };
}

function calculateChanges(
  current: Record<string, number>,
  previous?: Record<string, number>,
): Record<string, number> {
  if (!previous) return {};
  const changes: Record<string, number> = {};
  for (const key of Object.keys(current)) {
    const curr = current[key] ?? 0;
    const prev = previous[key] ?? 0;
    // No key when there is no baseline (KB-16): a change from nothing is
    // not 0%, and this is what the model reads.
    if (prev > 0) changes[key] = ((curr - prev) / prev) * 100;
  }
  return changes;
}

export async function processAnalyticsInsights(
  payload: Record<string, unknown>,
  _supabase: SupabaseClient,
): Promise<InsightsResult> {
  // SQS payload: cast, not validated (KB-33).
  const data = payload as unknown as AnalyticsInsightsPayload;

  console.log(`[Analytics Insights] Processing for project ${data.projectId}`);

  // Handle empty analytics
  if (!data.analytics?.totals) {
    return {
      success: true,
      data: {
        summary: 'Not enough data to generate insights.',
        trends: [],
        contentRecommendations: [],
        postingStrategy: [],
        audienceInsights: [],
        topPerformers: [],
        actionItems: ['Publish content to start tracking analytics'],
      },
    };
  }

  // Prepare analytics summary for LLM
  const analyticsSummary = {
    totals: data.analytics.totals,
    previousPeriodChange: calculateChanges(
      data.analytics.totals as unknown as Record<string, number>,
      data.analytics.previousPeriodTotals,
    ),
    platformBreakdown: data.analytics.platformMetrics,
    topContent: data.analytics.topContent?.slice(0, 5),
    audience: data.analytics.audience,
    contentCount: data.analytics.contentCount,
    avgEngagementRate: data.analytics.avgEngagementRate,
  };

  // Execute LLM
  const { executeLLM } = await import('@kit/prompt-engine/server');

  interface InsightsLLMOutput {
    performanceSummary: string;
    contentRecommendations: string[];
    postingStrategy: string[];
    audienceInsights: string[];
    topPerformers: string[];
    actionItems: string[];
  }

  try {
    const result = await executeLLM<InsightsLLMOutput>({
      templateSlug: 'insights-generation',
      variables: {
        analytics_data: JSON.stringify(analyticsSummary, null, 2),
      },
      context: {
        name: 'generate-analytics-insights',
        accountId: data.projectId,
        userId: data.userId,
      },
    });

    console.log('[Analytics Insights] Generated insights successfully');

    return {
      success: true,
      data: {
        summary: result.data.performanceSummary || 'Analysis complete.',
        trends: [],
        contentRecommendations: result.data.contentRecommendations || [],
        postingStrategy: result.data.postingStrategy || [],
        audienceInsights: result.data.audienceInsights || [],
        topPerformers: [],
        actionItems: result.data.actionItems || [],
      },
    };
  } catch (error) {
    console.error('[Analytics Insights] Error:', error);
    return {
      success: true,
      data: {
        summary: 'Unable to generate AI insights at this time.',
        trends: [],
        contentRecommendations: [],
        postingStrategy: [],
        audienceInsights: [],
        topPerformers: [],
        actionItems: [],
      },
    };
  }
}
