'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
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
    topLanguage: string;
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
    topLanguage: string;
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
export const generateLanguageInsightsAction = enhanceAction(
    async function ({ projectId }): Promise<LanguageInsightsResult & { queued?: boolean }> {
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

        // Handle empty data case
        if (!languagePerformance || languagePerformance.length === 0) {
            return {
                summary:
                    'Not enough language data to generate insights. Publish content in multiple languages to see AI-powered recommendations.',
                topLanguage: 'en',
                recommendations: [
                    'Connect platform accounts for different languages to start tracking multi-language performance',
                ],
                platformInsights: [],
                contentInsights: [],
                geographyInsights: [],
                actions: ['Publish content to start generating language insights'],
            };
        }

        // Always queue to Lambda for processing
        const { queueLlmJob } = await import('@kit/prompt-engine/server');

        await queueLlmJob({
            jobType: 'language-insights',
            userId: user.id,
            payload: {
                projectId,
                languagePerformance,
                platformMatrix: platformMatrix.slice(0, 20),
                contentType,
                shorts,
                geography,
                userId: user.id,
            },
        });

        return {
            summary: 'Generating language insights in the background...',
            topLanguage: 'en',
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
