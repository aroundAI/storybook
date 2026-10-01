import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSIGHTS_CACHE_TTL_MS,
  INSIGHTS_PROMPT_VERSION,
  insightsInputHash,
  processAnalyticsInsights,
} from '../handlers/analytics-insights';

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

interface CacheRow {
  insights: unknown;
  created_at: string;
}

const cache = vi.hoisted(() => ({
  row: null as CacheRow | null,
  reads: [] as Array<Record<string, string>>,
  writes: [] as Array<Record<string, unknown>>,
}));

const supabase = {
  from: (table: string) => {
    expect(table).toBe('analytics_insights_cache');
    const filters: Record<string, string> = {};
    const query = {
      select: () => query,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return query;
      },
      maybeSingle: async () => {
        cache.reads.push({ ...filters });
        return { data: cache.row, error: null };
      },
      upsert: async (row: Record<string, unknown>) => {
        cache.writes.push(row);
        return { error: null };
      },
    };
    return query;
  },
} as unknown as SupabaseClient;

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
  cache.row = null;
  cache.reads.length = 0;
  cache.writes.length = 0;
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
      processAnalyticsInsights(
        payload({ audience: { demographics: { ageGroups: { '25-34': 40 } } } }),
        supabase,
      ),
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

describe('the insights cache (FILM-808)', () => {
  const answer = {
    performanceSummary: 'Views are up.',
    contentRecommendations: ['Post shorter cuts'],
  };
  const cachedData = {
    summary: 'From the cache.',
    trends: [],
    contentRecommendations: [],
    postingStrategy: [],
    audienceInsights: [],
    topPerformers: [],
    actionItems: [],
  };
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('writes a miss to the cache under the project and the input hash', async () => {
    llm.respond = async () => ({ data: answer });

    await processAnalyticsInsights(payload(), supabase);

    expect(cache.writes).toHaveLength(1);
    expect(cache.writes[0]).toMatchObject({
      project_id: PROJECT,
      input_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      insights: { summary: 'Views are up.' },
    });
    expect(cache.reads[0]).toEqual({
      project_id: PROJECT,
      input_hash: cache.writes[0]!.input_hash,
    });
  });

  it('serves a fresh hit without calling the model', async () => {
    cache.row = { insights: cachedData, created_at: ago(60_000) };

    const result = await processAnalyticsInsights(payload(), supabase);

    expect(result).toEqual({ success: true, data: cachedData });
    expect(llm.calls).toHaveLength(0);
    expect(cache.writes).toHaveLength(0);
  });

  it('calls the model again once the row is older than the TTL', async () => {
    llm.respond = async () => ({ data: answer });
    cache.row = {
      insights: cachedData,
      created_at: ago(INSIGHTS_CACHE_TTL_MS + 1000),
    };

    const result = await processAnalyticsInsights(payload(), supabase);

    expect(llm.calls).toHaveLength(1);
    expect(result.data.summary).toBe('Views are up.');
    expect(cache.writes).toHaveLength(1);
  });

  it('bypasses a fresh hit when refresh is set, and overwrites it', async () => {
    llm.respond = async () => ({ data: answer });
    cache.row = { insights: cachedData, created_at: ago(60_000) };

    const result = await processAnalyticsInsights(
      { ...payload(), refresh: true },
      supabase,
    );

    expect(cache.reads).toHaveLength(0);
    expect(llm.calls).toHaveLength(1);
    expect(result.data.summary).toBe('Views are up.');
    expect(cache.writes).toHaveLength(1);
  });

  it('keys a different summary differently, and the same one identically', async () => {
    llm.respond = async () => ({ data: answer });

    await processAnalyticsInsights(payload(), supabase);
    await processAnalyticsInsights(payload(), supabase);
    await processAnalyticsInsights(
      payload({ totals: totals({ views: 999 }) }),
      supabase,
    );

    const [a, b, c] = cache.writes.map((w) => w.input_hash);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('does not cache the fallback answer when the model fails', async () => {
    llm.respond = async () => {
      throw new Error('rate limited');
    };

    await processAnalyticsInsights(payload(), supabase);

    expect(cache.writes).toHaveLength(0);
  });
});

describe('trends, audience and top performers (FILM-808)', () => {
  const trendFacts = [
    {
      metric: 'views',
      platform: 'all',
      current: 200,
      previous: 100,
      changePercent: 100,
    },
  ];
  const audience = {
    demographics: { ageGroups: { '25-34': 40 } },
    geography: { US: 60 },
  };
  const topContent = [
    {
      id: 'p1',
      title: 'Pilot',
      views: 150,
      likes: 9,
      engagementRate: 0.06,
      platform: 'youtube',
    },
    {
      id: 'p2',
      title: 'Episode 2',
      views: 50,
      likes: 1,
      engagementRate: 0.02,
      platform: 'tiktok',
    },
  ];
  const modelAnswer = {
    performanceSummary: 'Views doubled.',
    trends: ['Views rose 100% across the selected platforms.'],
    audienceInsights: ['40% of measured viewers are 25-34.'],
    topPerformers: [
      { contentId: 'p1', analysis: 'Most views, 6% engagement.' },
      { contentId: 'p1', analysis: 'A duplicate.' },
      { contentId: 'made-up', analysis: 'Not a supplied video.' },
      { contentId: 'p2', analysis: '  ' },
    ],
  };

  it('sends the trend facts, audience and top content to the model', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    await processAnalyticsInsights(
      payload({ trendFacts, audience, topContent }),
      supabase,
    );

    const sent = JSON.parse(llm.calls[0]!.variables.analytics_data) as Record<
      string,
      unknown
    >;

    expect(sent.trendFacts).toEqual(trendFacts);
    expect(sent.audience).toEqual(audience);
    expect(sent.topContent).toEqual(topContent);
  });

  it('returns the model’s trends, audience reading and grounded performers', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    const result = await processAnalyticsInsights(
      payload({ trendFacts, audience, topContent }),
      supabase,
    );

    expect(result.data.trends).toEqual([
      'Views rose 100% across the selected platforms.',
    ]);
    expect(result.data.audienceInsights).toEqual([
      '40% of measured viewers are 25-34.',
    ]);
    expect(result.data.topPerformers).toEqual([
      { title: 'Pilot', analysis: 'Most views, 6% engagement.' },
    ]);
  });

  it('drops what the model said about inputs it was not given', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    const result = await processAnalyticsInsights(payload(), supabase);

    expect(result.data.trends).toEqual([]);
    expect(result.data.audienceInsights).toEqual([]);
    expect(result.data.topPerformers).toEqual([]);
  });

  it('counts an audience with no split in it as no audience', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    const result = await processAnalyticsInsights(
      payload({ audience: { demographics: {}, geography: {} } }),
      supabase,
    );

    expect(result.data.audienceInsights).toEqual([]);
  });

  it('keys the new inputs into the cache, so a changed one is a miss', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    await processAnalyticsInsights(payload(), supabase);
    await processAnalyticsInsights(payload({ trendFacts }), supabase);
    await processAnalyticsInsights(payload({ audience }), supabase);
    await processAnalyticsInsights(payload({ topContent }), supabase);

    const hashes = new Set(cache.writes.map((w) => w.input_hash));

    expect(hashes.size).toBe(4);
  });

  it('serves a stored answer that carries the new fields on a hit', async () => {
    llm.respond = async () => ({ data: modelAnswer });
    const input = payload({ trendFacts, audience, topContent });

    const first = await processAnalyticsInsights(input, supabase);

    cache.row = {
      insights: first.data,
      created_at: new Date().toISOString(),
    };
    llm.calls.length = 0;

    const second = await processAnalyticsInsights(input, supabase);

    expect(llm.calls).toHaveLength(0);
    expect(second.data.topPerformers).toEqual(first.data.topPerformers);
    expect(second.data.trends).toEqual(first.data.trends);
  });

  it('keys the prompt version in, so an answer from an earlier prompt is a miss', async () => {
    llm.respond = async () => ({ data: modelAnswer });

    await processAnalyticsInsights(payload(), supabase);

    const summary = {
      totals: totals(),
      previousPeriodChange: {},
      contentCount: 4,
      avgEngagementRate: 0.05,
    };

    expect(cache.writes[0]!.input_hash).toBe(
      insightsInputHash({
        ...summary,
        promptVersion: INSIGHTS_PROMPT_VERSION,
      }),
    );
    expect(cache.writes[0]!.input_hash).not.toBe(insightsInputHash(summary));
  });
});
