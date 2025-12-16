'use server';

import 'server-only';

import { z } from 'zod';

import { createLLMClient } from '@kit/llm';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';

import type {
  AggregateAnalytics,
  AnalyticsTotals,
  InsightsResult,
} from '../types';

/**
 * Zod schemas for analytics validation
 */
const AnalyticsTotalsSchema = z.object({
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  watchTimeSeconds: z.number(),
  subscribersGained: z.number(),
  revenueCents: z.number(),
  contentCount: z.number(),
});

const PlatformBreakdownSchema = z.object({
  platform: z.enum(['youtube', 'tiktok', 'instagram']),
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
});

const TopContentSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().optional(),
  views: z.number(),
  likes: z.number(),
  engagementRate: z.number(),
  platform: z.string(),
});

const AudienceDataSchema = z.object({
  demographics: z
    .object({
      ageGroups: z.record(z.number()).optional(),
      genders: z.record(z.number()).optional(),
    })
    .optional(),
  geography: z.record(z.number()).optional(),
});

const AggregateAnalyticsSchema = z
  .object({
    totals: AnalyticsTotalsSchema,
    previousPeriodTotals: AnalyticsTotalsSchema.optional(),
    platformMetrics: z.array(PlatformBreakdownSchema).optional(),
    topContent: z.array(TopContentSchema).optional(),
    audience: AudienceDataSchema.optional(),
    contentCount: z.number(),
    avgEngagementRate: z.number(),
  })
  .nullable();

/**
 * Schema for generate insights action
 */
const GenerateInsightsSchema = z.object({
  projectId: z.string().uuid(),
  analytics: AggregateAnalyticsSchema,
});

/**
 * Calculate percentage changes between current and previous period
 */
export function calculateChanges(
  current: AnalyticsTotals,
  previous?: AnalyticsTotals,
): Record<string, number> {
  const changes: Record<string, number> = {};

  if (!previous) {
    return changes;
  }

  const keys: (keyof AnalyticsTotals)[] = [
    'views',
    'likes',
    'comments',
    'shares',
    'watchTimeSeconds',
    'subscribersGained',
    'revenueCents',
    'contentCount',
  ];

  for (const key of keys) {
    const currentVal = current[key] || 0;
    const previousVal = previous[key] || 0;

    if (previousVal > 0) {
      changes[key] = ((currentVal - previousVal) / previousVal) * 100;
    } else {
      changes[key] = currentVal > 0 ? 100 : 0;
    }
  }

  return changes;
}

/**
 * Safely parse JSON from LLM response
 */
export function parseInsightsResponse(
  content: string,
): Partial<InsightsResult> {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr =
      jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : content.trim();

    return JSON.parse(jsonStr) as Partial<InsightsResult>;
  } catch {
    // If parsing fails, try to extract what we can
    return {};
  }
}

/**
 * Generate AI-powered analytics insights
 *
 * Uses LLM to analyze analytics data and provide actionable recommendations.
 * Results are intended to be cached client-side for 1 hour.
 */
export const generateInsightsAction = enhanceAction(
  async function ({ analytics }): Promise<InsightsResult> {
    // Handle empty analytics case
    if (!analytics || !analytics.totals) {
      return {
        summary:
          'Not enough data available to generate insights. Start publishing content to see AI-powered recommendations.',
        trends: [],
        contentRecommendations: [],
        postingStrategy: [],
        audienceInsights: [],
        topPerformers: [],
        actionItems: [
          'Publish your first piece of content to start tracking analytics',
        ],
      };
    }

    const llmClient = createLLMClient();

    // Prepare analytics summary for LLM (only aggregate data, no PII)
    const analyticsSummary = {
      totals: analytics.totals,
      previousPeriodChange: calculateChanges(
        analytics.totals,
        analytics.previousPeriodTotals,
      ),
      platformBreakdown: analytics.platformMetrics,
      topContent: analytics.topContent?.slice(0, 5),
      audience: analytics.audience,
      contentCount: analytics.contentCount,
      avgEngagementRate: analytics.avgEngagementRate,
    };

    const prompt = `You are an expert social media analytics consultant. Analyze the following content performance data and provide actionable insights.

## Analytics Data
${JSON.stringify(analyticsSummary, null, 2)}

## Your Task
Provide insights in the following JSON format:
{
  "summary": "A 2-3 sentence overview of overall performance",
  "trends": ["Array of 3-4 key trend observations"],
  "contentRecommendations": ["Array of 3-4 specific content recommendations"],
  "postingStrategy": ["Array of 2-3 posting time/frequency recommendations"],
  "audienceInsights": ["Array of 2-3 audience-related insights"],
  "topPerformers": [
    {
      "title": "Video title from the data",
      "thumbnailUrl": "thumbnail URL from data if available",
      "analysis": "Why this performed well"
    }
  ],
  "actionItems": ["Array of 3-5 specific actions to take this week"]
}

Guidelines:
- Be specific and actionable, not generic
- Reference actual numbers from the data
- Compare to previous period when relevant
- Consider platform-specific best practices
- Focus on growth opportunities
- If data is limited, acknowledge it and provide general recommendations

Return ONLY the JSON object, no markdown formatting or explanation.`;

    try {
      const response = await llmClient.createChatCompletion({
        messages: [
          {
            role: 'system',
            content:
              'You are an expert social media analytics consultant specializing in content performance optimization. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        maxTokens: 2000,
      });

      const insights = parseInsightsResponse(response.message.content);

      return {
        summary:
          insights.summary ||
          'Performance analysis complete. Review the trends and recommendations below.',
        trends: insights.trends || [],
        contentRecommendations: insights.contentRecommendations || [],
        postingStrategy: insights.postingStrategy || [],
        audienceInsights: insights.audienceInsights || [],
        topPerformers: insights.topPerformers || [],
        actionItems: insights.actionItems || [],
      };
    } catch (error) {
      // Return fallback response on error
      const logger = await getLogger();
      logger.error({ error }, 'Error generating insights');

      return {
        summary:
          'Unable to generate AI insights at this time. Please try again later.',
        trends: [],
        contentRecommendations: [],
        postingStrategy: [],
        audienceInsights: [],
        topPerformers: [],
        actionItems: [],
      };
    }
  },
  {
    auth: true,
    schema: GenerateInsightsSchema,
  },
);
