import { describe, expect, it, vi } from 'vitest';

import { listExperimentsAction } from '../src/server/experiment-actions';

/**
 * The experiment list is paged (FILM-1610 review 2, R6). PostgREST caps a
 * read at 1,000 rows and says nothing when it does, so an account past that
 * would see a list that looks complete and is not.
 */

const TOTAL = 1_005;
const ranges: Array<[number, number]> = [];

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/clickhouse/server', () => ({}));
vi.mock('../src/server/watched-metric-snapshot', () => ({}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => {
      const builder = {
        // An unpaged read: the server returns its first 1,000 rows and no
        // error, which is exactly what makes the cap invisible.
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            data: Array.from({ length: 1_000 }, (_, index) => ({
              id: `e${index}`,
            })),
            error: null,
          }),
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        // Serves at most 1,000 rows per request, as the server does.
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          const end = Math.min(to, from + 999, TOTAL - 1);
          const data =
            from >= TOTAL
              ? []
              : Array.from({ length: end - from + 1 }, (_, index) => ({
                  id: `e${from + index}`,
                }));
          return { data, error: null };
        },
      };
      return builder;
    },
  }),
}));

describe('listExperimentsAction', () => {
  it('returns every experiment past the 1,000-row cap', async () => {
    const rows = await listExperimentsAction({ accountId: 'a1' });

    expect(rows).toHaveLength(TOTAL);
    expect(ranges.length).toBeGreaterThan(1);
  });
});
