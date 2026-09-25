/**
 * Language Insights Handler
 *
 * Generates AI-powered multi-language analytics insights.
 * No database writes - returns insights to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizeStrings } from '@kit/episodes/lib';
import { z } from 'zod';

import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

const LanguageRowSchema = z.object({ language: z.string(), views: z.number() });

interface LanguageInsightsResult {
  success: boolean;
  data: {
    summary: string;
    /** Null when nothing names one — never defaulted to a language. */
    topLanguage: string | null;
    recommendations: string[];
    platformInsights: string[];
    contentInsights: string[];
    geographyInsights: string[];
    actions: string[];
  };
}

export async function processLanguageInsights(
  payload: Record<string, unknown>,
  _supabase: SupabaseClient<Database>,
): Promise<LanguageInsightsResult> {
  const data = parseLlmJobPayload('language-insights', payload);

  console.log(`[Language Insights] Processing for project ${data.projectId}`);

  // Handle empty data
  if (!data.languagePerformance?.length) {
    return {
      success: true,
      data: {
        summary: 'Not enough language data to generate insights.',
        topLanguage: null,
        recommendations: ['Publish content in multiple languages'],
        platformInsights: [],
        contentInsights: [],
        geographyInsights: [],
        actions: ['Publish content to start generating insights'],
      },
    };
  }

  // Prepare data for LLM
  const languageData = {
    languagePerformance: data.languagePerformance,
    platformMatrix: data.platformMatrix?.slice(0, 20),
    contentType: data.contentType,
    topShorts: data.shorts,
    geography: data.geography,
  };

  // Execute LLM
  const { executeLLM } = await import('@kit/prompt-engine/server');

  interface LanguageInsightsLLMOutput {
    languageSummary: string;
    topLanguage: string;
    languageRecommendations: string[];
    platformOptimization: string[];
    contentTypeInsights: string[];
    geographicOpportunities: string[];
    priorityActions: string[];
  }

  try {
    const result = await executeLLM<LanguageInsightsLLMOutput>({
      templateSlug: 'language-insights',
      variables: {
        // Languages, titles and places from the payload, defused (KB-101)
        language_data: JSON.stringify(sanitizeStrings(languageData), null, 2),
      },
      context: {
        name: 'generate-language-insights',
        accountId: data.accountId,
        userId: data.userId,
      },
    });

    console.log('[Language Insights] Generated insights successfully');

    return {
      success: true,
      data: {
        summary: result.data.languageSummary || 'Analysis complete.',
        topLanguage: result.data.topLanguage || null,
        recommendations: result.data.languageRecommendations || [],
        platformInsights: result.data.platformOptimization || [],
        contentInsights: result.data.contentTypeInsights || [],
        geographyInsights: result.data.geographicOpportunities || [],
        actions: result.data.priorityActions || [],
      },
    };
  } catch (error) {
    console.error('[Language Insights] Error:', error);

    // Fallback with basic insights, from the rows that say which language
    const rows = data.languagePerformance.flatMap((row) => {
      const parsed = LanguageRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
    const topLang = rows.reduce<{ language: string; views: number }>(
      (best, curr) => (curr.views > best.views ? curr : best),
      rows[0] ?? { language: 'unknown', views: 0 },
    );

    return {
      success: true,
      data: {
        summary: `Top performing language: ${topLang.language.toUpperCase()}`,
        topLanguage: topLang.language,
        recommendations: [`Focus on ${topLang.language} content`],
        platformInsights: [],
        contentInsights: [],
        geographyInsights: [],
        actions: ['Unable to generate AI insights. Try again later.'],
      },
    };
  }
}
