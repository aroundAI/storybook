'use server';

import 'server-only';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { executeLLM } from '@kit/prompt-engine/server';
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
interface LanguageInsightsLLMOutput {
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
 * Fetches all language analytics data and uses LLM to generate strategic recommendations.
 */
export const generateLanguageInsightsAction = enhanceAction(
    async function ({ projectId }): Promise<LanguageInsightsResult> {
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

        // Prepare data for LLM
        const languageData = {
            languagePerformance,
            platformMatrix: platformMatrix.slice(0, 20), // Limit for token efficiency
            contentType,
            topShorts: shorts,
            geography,
        };

        try {
            const result = await executeLLM<LanguageInsightsLLMOutput>({
                templateSlug: 'analytics/language-insights',
                variables: {
                    language_data: JSON.stringify(languageData, null, 2),
                },
                context: {
                    name: 'generate-language-insights',
                    accountId: projectId,
                    userId: user.id,
                },
            });

            return {
                summary:
                    result.data.languageSummary ||
                    'Language analysis complete. Review recommendations below.',
                topLanguage: result.data.topLanguage || 'en',
                recommendations: result.data.languageRecommendations || [],
                platformInsights: result.data.platformOptimization || [],
                contentInsights: result.data.contentTypeInsights || [],
                geographyInsights: result.data.geographicOpportunities || [],
                actions: result.data.priorityActions || [],
            };
        } catch (error) {
            logger.error({ error }, 'Error generating language insights');

            // Return fallback with basic insights
            const firstLang = languagePerformance[0];
            if (!firstLang) {
                return {
                    summary: 'Unable to generate AI insights. Try again later.',
                    topLanguage: 'en',
                    recommendations: [],
                    platformInsights: [],
                    contentInsights: [],
                    geographyInsights: [],
                    actions: ['Unable to generate AI insights. Try again later.'],
                };
            }

            const topLang = languagePerformance.reduce(
                (best, curr) => (curr.views > best.views ? curr : best),
                firstLang,
            );

            return {
                summary: `Your top performing language is ${topLang.language.toUpperCase()} with ${topLang.views.toLocaleString()} views.`,
                topLanguage: topLang.language,
                recommendations: [
                    `Focus on ${topLang.language.toUpperCase()} content which shows highest engagement`,
                ],
                platformInsights: [],
                contentInsights: [],
                geographyInsights: [],
                actions: ['Unable to generate AI insights. Try again later.'],
            };
        }
    },
    {
        auth: true,
        schema: GenerateLanguageInsightsSchema,
    },
);
