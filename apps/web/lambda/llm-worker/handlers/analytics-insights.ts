/**
 * Analytics Insights Handler
 *
 * Generates AI-powered analytics insights.
 * No database writes - returns insights to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

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
  _supabase: SupabaseClient<Database>,
): Promise<InsightsResult> {
  const data = parseLlmJobPayload('analytics-insights', payload);

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
        // Titles and platform names from the payload, defused (KB-101)
        analytics_data: JSON.stringify(
          sanitizeStrings(analyticsSummary),
          null,
          2,
        ),
      },
      context: {
        name: 'generate-analytics-insights',
        accountId: data.accountId,
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
