import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateInsightsAction } from '../src/server/insights-actions';
import { generateLanguageInsightsAction } from '../src/server/language-insights-actions';

/**
 * KB-31: the two insights jobs are project jobs. Queueing one needs write
 * access to the project (KB-28's `can_write_project`, asked as the caller),
 * and its usage is recorded on the project's account — before this, the
 * worker passed the project id as the account and the usage row lost it.
 */

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ACCOUNT = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  writable: true,
  sent: [] as Array<{ jobType: string; payload: Record<string, unknown> }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'user-1' }, error: null }),
}));

// The project is readable either way — as a public project is to anyone
vi.mock('@kit/supabase/server-client', () => {
  const found = {
    maybeSingle: async () => ({
      data: { id: PROJECT, account_id: PROJECT_ACCOUNT },
      error: null,
    }),
  };

  return {
    getSupabaseServerClient: () => ({
      from: () => ({ select: () => ({ eq: () => found }) }),
      rpc: async () => ({ data: state.writable, error: null }),
    }),
  };
});

vi.mock('@kit/prompt-engine/server', async () => {
  const { payloadForTarget } = await vi.importActual<
    typeof import('../../prompt-engine/src/lib/server/sqs-helper')
  >('../../prompt-engine/src/lib/server/sqs-helper');

  return {
    queueLlmJob: async (job: {
      jobType: string;
      target?: Parameters<typeof payloadForTarget>[0];
      payload: Record<string, unknown>;
    }) => {
      // A call without a target (before KB-31) sends its payload as is
      state.sent.push({
        jobType: job.jobType,
        payload: job.target
          ? payloadForTarget(job.target, job.payload)
          : job.payload,
      });
    },
  };
});

vi.mock('../src/server/language-analytics', () => ({
  getLanguagePerformance: async () => [{ language: 'es', views: 300 }],
  getPlatformLanguageMatrix: async () => [],
  getContentTypeComparison: async () => ({}),
  getShortsSourcePerformance: async () => [],
  getGeographyByLanguage: async () => [],
}));

const analytics = {
  totals: {
    views: 10,
    likes: 1,
    comments: 0,
    shares: 0,
    watchTimeSeconds: 60,
    subscribersGained: 0,
    revenueCents: 0,
    contentCount: 1,
  },
  contentCount: 1,
  avgEngagementRate: 0.1,
};

const actions = [
  {
    name: 'generateInsightsAction',
    run: () =>
      generateInsightsAction({
        projectId: PROJECT,
        analytics,
      } as Parameters<typeof generateInsightsAction>[0]),
  },
  {
    name: 'generateLanguageInsightsAction',
    run: () => generateLanguageInsightsAction({ projectId: PROJECT }),
  },
];

beforeEach(() => {
  state.writable = true;
  state.sent = [];
});

describe.each(actions)('$name', ({ run }) => {
  it('queues nothing for a project the caller can read but not write', async () => {
    state.writable = false;

    await expect(run()).rejects.toThrow('Project not found');
    expect(state.sent).toEqual([]);
  });

  it('records the job on the project’s account', async () => {
    await run();

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.payload.accountId).toBe(PROJECT_ACCOUNT);
  });
});
