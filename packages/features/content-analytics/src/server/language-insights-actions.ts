'use server';

import 'server-only';

import { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  getContentTypeComparison,
  getGeographyByLanguage,
  getLanguagePerformance,
  getPlatformLanguageMatrix,
  getShortsSourcePerformance,
} from './language-analytics';

/**
 * Schema for language insights action
 */
const GenerateLanguageInsightsSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * Output from LLM for language insights
 */
interface _LanguageInsightsLLMOutput {
  languageSummary: string;
  topLanguage: string | null;
  languageRecommendations: string[];
  platformOptimization: string[];
  contentTypeInsights: string[];
  geographicOpportunities: string[];
  priorityActions: string[];
}

/**
 * Language insights result type
 */
export interface LanguageInsightsResult {
  summary: string;
  /** Null until the model names one. Never defaulted to a language. */
  topLanguage: string | null;
  recommendations: string[];
  platformInsights: string[];
  contentInsights: string[];
  geographyInsights: string[];
  actions: string[];
  isLoading?: boolean;
}

/**
 * Generate AI-powered multi-language analytics insights
 *
 * In production, queues via SQS for background processing.
 */
const generateLanguageInsights = enhanceAction(
  async function ({
    projectId,
  }): Promise<LanguageInsightsResult & { queued?: boolean }> {
    const logger = await getLogger();
    const ctx = { name: 'analytics.generateLanguageInsights' };

    // Authenticate user
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized language insights generation attempt');
      throw new Error('Authentication required');
    }

    // Fetch all language analytics data in parallel
    const [
      languagePerformance,
      platformMatrix,
      contentType,
      shorts,
      geography,
    ] = await Promise.all([
      getLanguagePerformance(projectId),
      getPlatformLanguageMatrix(projectId),
      getContentTypeComparison(projectId),
      getShortsSourcePerformance(projectId, { limit: 5 }),
      getGeographyByLanguage(projectId),
    ]);

    // Only languages somebody set. The unlabelled bucket is not a language
    // the model can recommend for or against, and the worker upper-cases
    // `language` on its fallback path, so a null would crash it outright.
    const isLabelled = (entry: { language: string | null }) =>
      entry.language !== null;
    const labelledPerformance = languagePerformance.filter(isLabelled);

    // Handle empty data case
    if (labelledPerformance.length === 0) {
      return {
        summary:
          'Not enough language data to generate insights. Publish content in multiple languages to see AI-powered recommendations.',
        topLanguage: null,
        recommendations: [
          'Connect platform accounts for different languages to start tracking multi-language performance',
        ],
        platformInsights: [],
        contentInsights: [],
        geographyInsights: [],
        actions: ['Publish content to start generating language insights'],
      };
    }

    // The reads above are account-scoped; queueing a project job needs
    // project write access, and records usage on the project's account (KB-31)
    const target = await authorizeProjectTarget(client, projectId);

    if (!target) {
      throw new ActionRefusal('Project not found');
    }

    // Always queue to Lambda for processing
    const { openRunForJob } = await import('@kit/ai-gateway');

    const run = await openRunForJob(
      {
        jobType: 'language-insights',
        userId: user.id,
        target,
        payload: {
          projectId,
          languagePerformance: labelledPerformance,
          platformMatrix: platformMatrix.filter(isLabelled).slice(0, 20),
          contentType,
          shorts: shorts.filter(isLabelled),
          geography: geography.filter(isLabelled),
          userId: user.id,
        },
        name: 'analytics.generateLanguageInsights',
      },
      { client: client, accountId: target.accountId, userId: user.id },
    );
    await run.dispatch();

    return {
      summary: 'Generating language insights in the background...',
      topLanguage: null,
      recommendations: [],
      platformInsights: [],
      contentInsights: [],
      geographyInsights: [],
      actions: [],
      queued: true,
    };
  },
  {
    auth: true,
    schema: GenerateLanguageInsightsSchema,
  },
);

export const generateLanguageInsightsAction = returnRefusals(
  generateLanguageInsights,
);
