'use server';

import 'server-only';

import { z } from 'zod';

import { refuseRunError } from '@kit/ai-gateway/refuse-run-error';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { InsightsResult } from '../types';

/**
 * Zod schemas for analytics validation
 */
const AnalyticsTotalsSchema = z.object({
  // Null where every row is Facebook's: no single view (KB-153).
  views: z.number().nullable(),
  // Null where no row was read (KB-192).
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  // Null where no row measured it: X reports no shares (FILM-1727).
  shares: z.number().nullable(),
  // Null is "not measured" (KB-149), never sent to the model as 0.
  watchTimeSeconds: z.number().nullable(),
  subscribersGained: z.number().nullable(),
  // Null where no day's earnings were measured (FILM-1726).
  revenueCents: z.number().nullable(),
  contentCount: z.number(),
});

const PlatformBreakdownSchema = z.object({
  platform: z.enum(['youtube', 'tiktok', 'instagram', 'facebook']),
  views: z.number().nullable(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number().nullable(),
});

const TopContentSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().optional(),
  views: z.number().nullable(),
  likes: z.number(),
  engagementRate: z.number().nullable(),
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

const TrendFactSchema = z.object({
  metric: z.enum(['views', 'likes', 'comments', 'shares']),
  platform: z.string(),
  current: z.number(),
  previous: z.number(),
  changePercent: z.number(),
});

const AggregateAnalyticsSchema = z
  .object({
    totals: AnalyticsTotalsSchema,
    previousPeriodTotals: AnalyticsTotalsSchema.optional(),
    platformMetrics: z.array(PlatformBreakdownSchema).optional(),
    topContent: z.array(TopContentSchema).optional(),
    audience: AudienceDataSchema.optional(),
    trendFacts: z.array(TrendFactSchema).max(40).optional(),
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
  refresh: z.boolean().optional(),
});

/**
 * Output schema for executeLLM
 */
interface _InsightsLLMOutput {
  performanceSummary: string;
  contentRecommendations: string[];
  postingStrategy: string[];
  audienceInsights: string[];
  topPerformers: Array<{ contentId: string; analysis: string }>;
  actionItems: string[];
}

/**
 * Generate AI-powered analytics insights
 *
 * Uses LLM to analyze analytics data and provide actionable recommendations.
 * In production, queues via SQS for background processing.
 */
const generateInsights = enhanceAction(
  async function ({
    projectId,
    analytics,
    refresh,
  }): Promise<InsightsResult & { queued?: boolean }> {
    const logger = await getLogger();
    const ctx = { name: 'analytics.generateInsights' };

    // Get authenticated user
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized insights generation attempt');
      throw new Error('Authentication required');
    }

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

    // A project job: the caller must be able to write to the project, and
    // the job's usage is recorded on the project's account (KB-31)
    const target = await authorizeProjectTarget(client, projectId);

    if (!target) {
      throw new ActionRefusal('Project not found');
    }

    // Always queue to Lambda for processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'analytics-insights',
        userId: user.id,
        target,
        payload: {
          projectId,
          analytics,
          userId: user.id,
          refresh,
        },
        name: 'analytics.generateInsights',
      },
      { client: client, accountId: target.accountId, userId: user.id },
    ).catch(refuseRunError);
    await run.dispatch();

    return {
      summary: 'Generating insights in the background...',
      trends: [],
      contentRecommendations: [],
      postingStrategy: [],
      audienceInsights: [],
      topPerformers: [],
      actionItems: [],
      queued: true,
    };
  },
  {
    auth: true,
    schema: GenerateInsightsSchema,
  },
);

export const generateInsightsAction = returnRefusals(generateInsights);
