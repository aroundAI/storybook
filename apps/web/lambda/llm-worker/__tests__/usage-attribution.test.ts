import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processAnalyticsInsights } from '../handlers/analytics-insights';
import { processFactExtraction } from '../handlers/fact-extraction';
import { processLanguageInsights } from '../handlers/language-insights';
import { commitStoryCanon } from '../utils/commit-story-canon';

/**
 * KB-31: a job's LLM usage is recorded on the account that owns its target.
 *
 * These three handlers passed the *project* id as `accountId`. The usage
 * table's `account_id` is a foreign key to accounts, so `logLLMUsage` either
 * nulls it (not a valid account) or the row is dropped — either way no
 * account is charged. `queueLlmJob` now stamps the project's account on
 * every payload as `accountId`.
 */

const PROJECT = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';

const contexts = vi.hoisted(() => [] as Array<{ accountId: string }>);

vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: async (config: { context: { accountId: string } }) => {
    contexts.push(config.context);
    return { data: {} };
  },
}));

const supabase = {
  from: () => ({ insert: async () => ({ error: null }) }),
} as unknown as SupabaseClient;

beforeEach(() => {
  contexts.length = 0;
});

describe('LLM usage attribution in the worker', () => {
  it('analytics insights: the project’s account, not the project', async () => {
    await processAnalyticsInsights(
      {
        projectId: PROJECT,
        accountId: ACCOUNT,
        userId: USER,
        analytics: {
          totals: {
            views: 1,
            likes: 0,
            comments: 0,
            shares: 0,
            watchTimeSeconds: 0,
            subscribersGained: 0,
            revenueCents: 0,
            contentCount: 1,
          },
          contentCount: 1,
          avgEngagementRate: 0,
        },
      },
      supabase,
    ).catch(() => undefined);

    expect(contexts[0]?.accountId).toBe(ACCOUNT);
  });

  it('language insights: the project’s account, not the project', async () => {
    await processLanguageInsights(
      {
        projectId: PROJECT,
        accountId: ACCOUNT,
        userId: USER,
        languagePerformance: [{ language: 'es', views: 1 }],
        platformMatrix: [],
        contentType: {},
        shorts: [],
        geography: [],
      },
      supabase,
    ).catch(() => undefined);

    expect(contexts[0]?.accountId).toBe(ACCOUNT);
  });

  it('fact extraction: the project’s account, not the project', async () => {
    await processFactExtraction(
      {
        projectId: PROJECT,
        accountId: ACCOUNT,
        userId: USER,
        content: 'Some source text.',
        sourceTitle: 'Source',
      },
      supabase,
    ).catch(() => undefined);

    expect(contexts[0]?.accountId).toBe(ACCOUNT);
  });

  it('canon extraction (KB-129): the job’s account, not the project', async () => {
    // Every query settles with no rows and no error, whatever is chained on it.
    const anyQuery: unknown = new Proxy(() => undefined, {
      get: (_, key) =>
        key === 'then'
          ? (resolve: (value: unknown) => unknown) =>
              resolve({ data: [], error: null })
          : anyQuery,
      apply: () => anyQuery,
    });

    await commitStoryCanon({
      projectId: PROJECT,
      accountId: ACCOUNT,
      episodeId: '33333333-3333-4333-8333-333333333333',
      episodeNumber: 1,
      season: 1,
      keyEvents: [],
      characters: [],
      storyContent: 'A story long enough to be worth extracting. '.repeat(5),
      createdBy: USER,
      supabase: { from: () => anyQuery, rpc: () => anyQuery } as never,
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.accountId).toBe(ACCOUNT);
  });
});
