import { beforeEach, describe, expect, it, vi } from 'vitest';

import { unwrap } from '@kit/next/action-result';

import { generateLanguageInsightsAction } from '../src/server/language-insights-actions';

/**
 * What the language-insights job is sent (FILM-1702).
 *
 * The unlabelled bucket is usually the largest, and it is not a language: a
 * model handed it writes "focus on null", and the worker's fallback path
 * upper-cases `language` and would throw on it.
 */
const mocks = vi.hoisted(() => ({
  openRunForJob: vi.fn(async (_job: { payload: Record<string, unknown> }) => ({
    id: 'run-under-test',
    mode: 'server',
    dispatch: async () => undefined,
  })),
  performance: [] as Array<{ language: string | null; views: number }>,
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

// A writer of the project (KB-31): the project row and `can_write_project`
vi.mock('@kit/supabase/server-client', () => {
  const found = {
    maybeSingle: async () => ({
      data: { id: 'p', account_id: 'account-1' },
      error: null,
    }),
  };

  return {
    getSupabaseServerClient: () => ({
      from: () => ({ select: () => ({ eq: () => found }) }),
      rpc: async () => ({ data: true, error: null }),
    }),
  };
});

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'user-1' }, error: null }),
}));

vi.mock('@kit/ai-gateway', () => ({
  openRunForJob: mocks.openRunForJob,
}));

vi.mock('../src/server/language-analytics', () => ({
  getLanguagePerformance: async () => mocks.performance,
  getPlatformLanguageMatrix: async () => [
    { platform: 'youtube', language: null, views: 5000 },
    { platform: 'youtube', language: 'es', views: 300 },
  ],
  getContentTypeComparison: async () => ({}),
  getShortsSourcePerformance: async () => [
    { publishId: 's1', language: null },
    { publishId: 's2', language: 'es' },
  ],
  getGeographyByLanguage: async () => [
    { language: null, countries: [] },
    { language: 'es', countries: [] },
  ],
}));

const run = () =>
  unwrap(
    generateLanguageInsightsAction({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    }),
  );

beforeEach(() => {
  mocks.openRunForJob.mockClear();
  mocks.performance = [
    { language: null, views: 5000 },
    { language: 'es', views: 300 },
  ];
});

describe('generateLanguageInsightsAction', () => {
  it('sends the model only languages somebody set', async () => {
    await run();

    const payload = mocks.openRunForJob.mock.calls[0]?.[0].payload;

    expect(payload?.languagePerformance).toEqual([
      { language: 'es', views: 300 },
    ]);
    expect(payload?.platformMatrix).toEqual([
      { platform: 'youtube', language: 'es', views: 300 },
    ]);
    expect(payload?.shorts).toEqual([{ publishId: 's2', language: 'es' }]);
    expect(payload?.geography).toEqual([{ language: 'es', countries: [] }]);
  });

  it('queues nothing when no video has a language, and names no top language', async () => {
    mocks.performance = [{ language: null, views: 5000 }];

    const result = await run();

    expect(mocks.openRunForJob).not.toHaveBeenCalled();
    // It used to answer 'en' here: a language, for a project with none.
    expect(result.topLanguage).toBeNull();
  });
});
