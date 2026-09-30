import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processAnalyticsInsights } from '../handlers/analytics-insights';

/**
 * FILM-808. What the worker does around the model: it sends a summary of the
 * analytics (previous-period change only where there is a baseline), maps the
 * model's answer to the fields the panel reads, and answers a plain fallback
 * when the model fails. The model is a stub; what it says is not tested here.
 */

const PROJECT = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';

const llm = vi.hoisted(() => ({
  calls: [] as Array<{
    templateSlug: string;
    variables: { analytics_data: string };
  }>,
  respond: (async () => ({ data: {} })) as () => Promise<{ data: unknown }>,
}));

vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: async (config: {
    templateSlug: string;
    variables: { analytics_data: string };
  }) => {
    llm.calls.push(config);
    return llm.respond();
  },
}));

const supabase = {} as SupabaseClient;

const totals = (over: Record<string, number> = {}) => ({
  views: 200,
  likes: 10,
  comments: 2,
  shares: 1,
  watchTimeSeconds: 600,
  subscribersGained: 3,
  revenueCents: 500,
  contentCount: 4,
  ...over,
});

const payload = (analytics: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  accountId: ACCOUNT,
  userId: USER,
  analytics: {
    totals: totals(),
    contentCount: 4,
    avgEngagementRate: 0.05,
    ...analytics,
  },
});

beforeEach(() => {
  llm.calls.length = 0;
  llm.respond = async () => ({ data: {} });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('processAnalyticsInsights', () => {
  it('maps the model’s answer to the fields the panel reads', async () => {
    llm.respond = async () => ({
      data: {
        performanceSummary: 'Views are up.',
        contentRecommendations: ['Post shorter cuts'],
        postingStrategy: ['Evenings'],
        audienceInsights: ['Mostly 25-34'],
        topPerformers: ['ignored'],
        actionItems: ['Reply to comments'],
      },
    });

    await expect(
      processAnalyticsInsights(payload(), supabase),
    ).resolves.toEqual({
      success: true,
      data: {
        summary: 'Views are up.',
        trends: [],
        contentRecommendations: ['Post shorter cuts'],
        postingStrategy: ['Evenings'],
        audienceInsights: ['Mostly 25-34'],
        topPerformers: [],
        actionItems: ['Reply to comments'],
      },
    });
    expect(llm.calls[0]?.templateSlug).toBe('insights-generation');
  });

  it('fills what the model left out with empty lists and a stock summary', async () => {
    llm.respond = async () => ({ data: { performanceSummary: '' } });

    const result = await processAnalyticsInsights(payload(), supabase);

    expect(result.data).toEqual({
      summary: 'Analysis complete.',
      trends: [],
      contentRecommendations: [],
      postingStrategy: [],
      audienceInsights: [],
      topPerformers: [],
      actionItems: [],
    });
  });

  it('answers a plain fallback, not an error, when the model fails', async () => {
    llm.respond = async () => {
      throw new Error('rate limited');
    };

    const result = await processAnalyticsInsights(payload(), supabase);

    expect(result.success).toBe(true);
    expect(result.data.summary).toBe(
      'Unable to generate AI insights at this time.',
    );
    expect(result.data.actionItems).toEqual([]);
  });

  it('sends the previous-period change only where there was a baseline', async () => {
    await processAnalyticsInsights(
      payload({ previousPeriodTotals: totals({ views: 100, likes: 0 }) }),
      supabase,
    );

    const sent = JSON.parse(llm.calls[0]!.variables.analytics_data) as {
      previousPeriodChange: Record<string, number>;
    };

    expect(sent.previousPeriodChange.views).toBe(100);
    // likes had no baseline (0), so there is no change to report (KB-16).
    expect(sent.previousPeriodChange).not.toHaveProperty('likes');
  });

  it('sends no change figures at all without a previous period', async () => {
    await processAnalyticsInsights(payload(), supabase);

    const sent = JSON.parse(llm.calls[0]!.variables.analytics_data) as {
      previousPeriodChange: Record<string, number>;
    };

    expect(sent.previousPeriodChange).toEqual({});
  });

  it('sends at most the five top titles', async () => {
    const topContent = Array.from({ length: 8 }, (_, n) => ({
      id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
      title: `Video ${n}`,
      platform: 'youtube',
      views: 100 - n,
      likes: 1,
      comments: 0,
      shares: 0,
      engagementRate: 0.1,
    }));

    await processAnalyticsInsights(payload({ topContent }), supabase);

    const sent = JSON.parse(llm.calls[0]!.variables.analytics_data) as {
      topContent: unknown[];
    };

    expect(sent.topContent).toHaveLength(5);
  });
});
