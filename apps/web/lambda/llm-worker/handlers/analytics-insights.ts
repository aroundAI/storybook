/**
 * Analytics Insights Handler
 *
 * Generates AI-powered analytics insights.
 * A model answer is cached per project and input in
 * `analytics_insights_cache` (service role only) and served for
 * INSIGHTS_CACHE_TTL_MS; `refresh` skips the read and overwrites the row.
 * Nothing else is written - the answer goes back to the frontend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { createHash } from 'node:crypto';

import { sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

export const INSIGHTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type InsightsData = {
  summary: string;
  trends: string[];
  contentRecommendations: string[];
  postingStrategy: string[];
  audienceInsights: string[];
  topPerformers: string[];
  actionItems: string[];
};

interface InsightsResult {
  success: boolean;
  data: InsightsData;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

export function insightsInputHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function isInsightsData(value: unknown): value is InsightsData {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { summary?: unknown }).summary === 'string'
  );
}

async function readCachedInsights(
  supabase: SupabaseClient<Database>,
  projectId: string,
  inputHash: string,
): Promise<InsightsData | null> {
  try {
    const { data, error } = await supabase
      .from('analytics_insights_cache')
      .select('insights, created_at')
      .eq('project_id', projectId)
      .eq('input_hash', inputHash)
      .maybeSingle();

    if (error || !data) return null;

    const ageMs = Date.now() - new Date(data.created_at).getTime();

    if (!(ageMs >= 0 && ageMs < INSIGHTS_CACHE_TTL_MS)) return null;

    return isInsightsData(data.insights) ? data.insights : null;
  } catch (error) {
    console.error('[Analytics Insights] Cache read failed:', error);
    return null;
  }
}

async function writeCachedInsights(
  supabase: SupabaseClient<Database>,
  projectId: string,
  inputHash: string,
  insights: InsightsData,
): Promise<void> {
  try {
    const { error } = await supabase.from('analytics_insights_cache').upsert(
      {
        project_id: projectId,
        input_hash: inputHash,
        insights,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,input_hash' },
    );

    if (error) {
      console.error('[Analytics Insights] Cache write failed:', error.message);
    }
  } catch (error) {
    console.error('[Analytics Insights] Cache write failed:', error);
  }
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
  supabase: SupabaseClient<Database>,
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

  const inputHash = insightsInputHash(analyticsSummary);

  if (!data.refresh) {
    const cached = await readCachedInsights(
      supabase,
      data.projectId,
      inputHash,
    );

    if (cached) {
      console.log('[Analytics Insights] Served from cache');
      return { success: true, data: cached };
    }
  }

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

    const insights: InsightsData = {
      summary: result.data.performanceSummary || 'Analysis complete.',
      trends: [],
      contentRecommendations: result.data.contentRecommendations || [],
      postingStrategy: result.data.postingStrategy || [],
      audienceInsights: result.data.audienceInsights || [],
      topPerformers: [],
      actionItems: result.data.actionItems || [],
    };

    await writeCachedInsights(supabase, data.projectId, inputHash, insights);

    return { success: true, data: insights };
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
