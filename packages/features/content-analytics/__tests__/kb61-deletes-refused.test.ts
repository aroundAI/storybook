import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteScheduledReportAction } from '../src/server/report-actions';
import { deleteTagAction } from '../src/server/taxonomy-actions';

/**
 * KB-61. RLS answers a DELETE it filters out with `{ data: [], error: null }`,
 * as it does one that worked. A tag or a scheduled report the caller may
 * not delete was reported deleted; the tag manager then dropped it from the
 * list. Both now refuse when the delete removed nothing.
 */

const TAG = '00000000-0000-4000-8000-0000000000d4';
const REPORT = '00000000-0000-4000-8000-0000000000e5';

/** What the next delete reports removing: `[]` is RLS matching nothing. */
let removed: Array<{ id: string }> = [];

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  querySegmentPerformance: vi.fn(),
  queryQualityMetricsForVideos: vi.fn(),
  queryRetentionCurve: vi.fn(),
  queryTotalsByVideoIds: vi.fn(),
}));

vi.mock('../src/server/dim-sync', () => ({
  upsertVideoDims: async (ids: string[]) => ids.length,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: async () => ({ data: [], error: null }),
        delete: () => ({
          eq: () => ({
            select: async () => ({ data: removed, error: null }),
          }),
        }),
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  removed = [];
});

describe('deleting a tag (KB-61)', () => {
  it('refuses when the delete removed no row', async () => {
    await expect(deleteTagAction({ tagId: TAG })).resolves.toEqual({
      ok: false,
      error: "That tag wasn't deleted.",
    });
  });

  it('succeeds when it removed the tag', async () => {
    removed = [{ id: TAG }];

    await expect(deleteTagAction({ tagId: TAG })).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('deleting a scheduled report (KB-61)', () => {
  it('refuses when the delete removed no row', async () => {
    await expect(deleteScheduledReportAction({ id: REPORT })).resolves.toEqual({
      ok: false,
      error: "That scheduled report wasn't deleted.",
    });
  });

  it('succeeds when it removed the report', async () => {
    removed = [{ id: REPORT }];

    await expect(deleteScheduledReportAction({ id: REPORT })).resolves.toEqual({
      ok: true,
      data: { success: true },
    });
  });
});
