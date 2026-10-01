import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_ENUM_TYPE } from '../src/lib/platform-enum';

/**
 * The platform filter's boundary with SQL (FILM-1709): what a selection
 * becomes in a query, and the two selections that must never reach one.
 */

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => mockClient),
}));

interface QueryCall {
  query: string;
  query_params: Record<string, unknown>;
}

const mockClient = {
  query: vi.fn((_args: QueryCall) =>
    Promise.resolve({ json: () => Promise.resolve([]) }),
  ),
};

const PROJECT = '11111111-1111-4111-8111-111111111111';

function lastQuery(): QueryCall {
  const call = mockClient.query.mock.calls.at(-1);

  if (!call) throw new Error('no query was issued');

  return call[0];
}

describe('platform filter in SQL (FILM-1709)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
    process.env.CLICKHOUSE_ENABLED = 'true';
  });

  describe('metric tables (buildWhereClause)', () => {
    it('narrows by the selection, as the column’s own Enum', async () => {
      const { queryTotals } = await import('../src/queries');

      await queryTotals({
        projectId: PROJECT,
        platforms: ['youtube', 'instagram'],
      });

      const { query, query_params } = lastQuery();

      expect(query).toContain(
        `platform IN {platforms: Array(${PLATFORM_ENUM_TYPE})}`,
      );
      expect(query_params.platforms).toEqual(['youtube', 'instagram']);
    });

    it('reads every platform when the filter is absent', async () => {
      const { queryTotals } = await import('../src/queries');

      await queryTotals({ projectId: PROJECT });

      expect(lastQuery().query).not.toContain('platform IN');
    });

    it('refuses an empty selection instead of reading it as every platform', async () => {
      const { queryTotals } = await import('../src/queries');

      await expect(
        queryTotals({ projectId: PROJECT, platforms: [] }),
      ).rejects.toThrow(/at least one platform/);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('refuses a platform outside AnalyticsPlatform before any query', async () => {
      const { queryPlatformBreakdown } = await import('../src/queries');

      await expect(
        queryPlatformBreakdown({
          projectId: PROJECT,
          // A name a caller could only get here by casting: the type is
          // AnalyticsPlatform, the guard is for what the type cannot see.
          platforms: ['youtube', 'myspace'] as unknown as ['youtube'],
        }),
      ).rejects.toThrow(/Not an analytics platform: myspace/);
      expect(mockClient.query).not.toHaveBeenCalled();
    });
  });

  describe('video_dim scope (buildDimConditions)', () => {
    it('narrows by every selected platform, not the first', async () => {
      const { queryVideoLanguages } = await import('../src/queries-advanced');

      await queryVideoLanguages({
        scope: { projectId: PROJECT, platforms: ['tiktok', 'instagram'] },
      });

      const { query, query_params } = lastQuery();

      expect(query).toContain('platform IN {scopePlatforms: Array(String)}');
      expect(query_params.scopePlatforms).toEqual(['tiktok', 'instagram']);
    });

    it('refuses an empty selection', async () => {
      const { queryVideoLanguages } = await import('../src/queries-advanced');

      await expect(
        queryVideoLanguages({ scope: { projectId: PROJECT, platforms: [] } }),
      ).rejects.toThrow(/at least one platform/);
    });

    it('refuses an unknown platform on the String column too', async () => {
      const { queryVideoLanguages } = await import('../src/queries-advanced');

      // video_dim.platform is a String, so an unknown name would not error
      // there — it would answer with nothing, which reads as "no videos".
      await expect(
        queryVideoLanguages({
          scope: {
            projectId: PROJECT,
            platforms: ['myspace'] as unknown as ['youtube'],
          },
        }),
      ).rejects.toThrow(/Not an analytics platform: myspace/);
    });
  });
});
