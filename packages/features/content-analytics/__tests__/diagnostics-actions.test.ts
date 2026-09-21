import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRetentionCurveAction } from '../src/server/diagnostics-actions';

/**
 * FILM-1616 §2. `getRetentionCurveAction` is the first action in this
 * package to accept a bare resource id from the client rather than a scope
 * object, and `queryRetentionCurve` carries no tenant predicate of its own —
 * ClickHouse is outside Postgres RLS entirely, so there is no second line of
 * defence behind it.
 *
 * An action that hands a caller-supplied `publishId` straight to that query
 * returns any tenant's retention curve to anyone who can guess a uuid. That
 * is not hypothetical: KB-9 removed the Hook Lab for exactly this, on this
 * table, and FILM-1613 shipped in this same phase for the same bug class.
 *
 * The mitigation is resolving the publish through the **user-scoped** client,
 * so RLS answers the question. These tests pin that: a publish the caller
 * cannot see is refused, and the ClickHouse read never runs.
 */

const PUBLISH = '0b6f5a4e-3c1d-4e2f-9a8b-7c6d5e4f3a2b';
const PROJECT = '550e8400-e29b-41d4-a716-446655440000';

const state: {
  /** What the RLS-scoped `publishes` read returns. `null` = not visible. */
  publish: { id: string; episodes: { project_id: string } } | null;
  /** Arguments every `queryRetentionCurve` call received. */
  curveCalls: Array<{ videoId: string; projectIds?: string[] }>;
  /** Tables read through the admin client, which this action must not use. */
  adminReads: string[];
} = {
  publish: null,
  curveCalls: [],
  adminReads: [],
};

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
  queryRetentionCurve: async (input: {
    videoId: string;
    projectIds?: string[];
  }) => {
    state.curveCalls.push(input);

    return [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.5 },
    ];
  },
  queryRetentionCurves: async () => new Map(),
  queryQualityMetricsForVideos: async () => new Map(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.publish, error: null }),
        }),
      }),
    }),
  }),
}));

// Reaching for this at all is the failure mode under test: it bypasses RLS,
// so a lookup on it answers "does this row exist", not "may this caller see
// it". Any read through it fails the test that follows.
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: (table: string) => {
      state.adminReads.push(table);

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: PUBLISH, episodes: { project_id: PROJECT } },
              error: null,
            }),
          }),
        }),
      };
    },
  }),
}));

describe('getRetentionCurveAction', () => {
  beforeEach(() => {
    state.publish = null;
    state.curveCalls = [];
    state.adminReads = [];
  });

  it('refuses a publish the caller cannot see, and never reads ClickHouse', async () => {
    // RLS returns no row for another tenant's publish. The uuid is perfectly
    // well-formed — guessing one is the whole attack.
    state.publish = null;

    const result = await getRetentionCurveAction({ publishId: PUBLISH });

    expect(result.ok).toBe(false);
    expect(state.curveCalls).toEqual([]);
  });

  it('resolves the publish on the user-scoped client, never the admin one', async () => {
    state.publish = null;

    await getRetentionCurveAction({ publishId: PUBLISH });

    // An admin-client lookup would have found the row and returned a curve.
    expect(state.adminReads).toEqual([]);
  });

  it('returns the curve for a publish the caller can see', async () => {
    state.publish = { id: PUBLISH, episodes: { project_id: PROJECT } };

    const result = await getRetentionCurveAction({ publishId: PUBLISH });

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.points).toHaveLength(2);
  });

  it('bounds the ClickHouse read to the project the publish resolved to', async () => {
    state.publish = { id: PUBLISH, episodes: { project_id: PROJECT } };

    await getRetentionCurveAction({ publishId: PUBLISH });

    // Not the tenant check — that is the read above — but the read-volume
    // bound from #274, which only works when the caller passes the project
    // it already proved the caller owns.
    expect(state.curveCalls).toEqual([
      { videoId: PUBLISH, projectIds: [PROJECT] },
    ]);
  });
});
