/**
 * Language Insights Handler
 *
 * Generates AI-powered multi-language analytics insights.
 * No database writes - returns insights to frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface LanguageInsightsPayload {
  projectId: string;
  /** The project's account, stamped by queueLlmJob from its target (KB-31). */
  accountId: string;
  languagePerformance: Array<{
    language: string;
    views: number;
    likes: number;
    comments: number;
    engagementRate: number;
  }>;
  platformMatrix: Array<Record<string, unknown>>;
  contentType: Record<string, unknown>;
  shorts: Array<Record<string, unknown>>;
  geography: Record<string, unknown>;
  userId: string;
}

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
  _supabase: SupabaseClient,
): Promise<LanguageInsightsResult> {
  // SQS payload: cast, not validated (KB-33).
  const data = payload as unknown as LanguageInsightsPayload;

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
        language_data: JSON.stringify(languageData, null, 2),
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

    // Fallback with basic insights
    const topLang = data.languagePerformance.reduce(
      (best, curr) => (curr.views > best.views ? curr : best),
      data.languagePerformance[0]!,
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
