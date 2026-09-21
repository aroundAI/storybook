import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRetentionCurveAction,
  getWeeklyDiagnosticsAction,
} from '../src/server/diagnostics-actions';

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
const CONNECTION = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const state: {
  /** What the RLS-scoped `publishes` read returns. `null` = not visible. */
  publish: { id: string; episodes: { project_id: string } } | null;
  /** Arguments every `queryRetentionCurve` call received. */
  curveCalls: Array<{ videoId: string; projectIds?: string[] }>;
  /** Tables read through the admin client, which this action must not use. */
  adminReads: string[];
  /** Publishes the paged Postgres read returns. */
  publishes: Array<{
    id: string;
    title: string | null;
    platform: string;
    published_at: string | null;
  }>;
  /** What ClickHouse answers. Empty maps are `CLICKHOUSE_ENABLED=false`. */
  totals: Map<string, { views: number }>;
  quality: Map<string, { impressions: number; impressionsCtr: number }>;
  curves: Map<
    string,
    Array<{ elapsedRatio: number; audienceWatchRatio: number }>
  >;
  /** `.eq()` filters the publish query received, as [column, value]. */
  filters: Array<[string, unknown]>;
} = {
  publish: null,
  curveCalls: [],
  adminReads: [],
  publishes: [],
  totals: new Map(),
  quality: new Map(),
  curves: new Map(),
  filters: [],
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
  queryRetentionCurves: async () => state.curves,
  queryQualityMetricsForVideos: async () => state.quality,
  queryTotalsByVideoIds: async () => state.totals,
}));

vi.mock('@kit/shared/pagination', () => ({
  // Runs the builder the action hands over, against a recorder, so the
  // filters that actually reach Postgres can be asserted. Mocking the whole
  // read away would leave the channel filter untested — and accepting a
  // `connectionId` and then not filtering on it was the defect.
  fetchAllRows: async (
    build: (from: number, to: number) => unknown,
  ): Promise<unknown[]> => {
    build(0, 999);

    return state.publishes;
  },
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: async () => 'account-1',
}));

/** A chainable recorder: every filter is kept, every call returns itself. */
function queryRecorder() {
  const chain: Record<string, unknown> = {};

  for (const method of [
    'select',
    'eq',
    'not',
    'gte',
    'order',
    'range',
    'limit',
  ]) {
    chain[method] = (...args: unknown[]) => {
      if (method === 'eq') state.filters.push([args[0] as string, args[1]]);

      return chain;
    };
  }

  chain.maybeSingle = async () => ({ data: state.publish, error: null });
  chain.then = undefined;

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => queryRecorder(),
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
    state.publishes = [];
    state.totals = new Map();
    state.quality = new Map();
    state.curves = new Map();
    state.filters = [];
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

describe('getWeeklyDiagnosticsAction', () => {
  const scope = { projectId: PROJECT };
  const call = () =>
    getWeeklyDiagnosticsAction({ scope, sinceDays: 7, limit: 25 });

  beforeEach(() => {
    state.publishes = [
      {
        id: 'pub-measured',
        title: 'Measured',
        platform: 'youtube',
        published_at: '2026-09-20T00:00:00Z',
      },
      {
        id: 'pub-unmeasured',
        title: 'Never measured',
        platform: 'youtube',
        published_at: '2026-09-20T00:00:00Z',
      },
    ];
    state.totals = new Map();
    state.quality = new Map();
    state.curves = new Map();
  });

  it('renders no rows when ClickHouse is off (§8)', async () => {
    // Every query returns empty. A row here would carry `views: 0` for a
    // video nobody has measured, which reads as "nobody watched" — the
    // error §3 forbids for the curve, and no better for the row.
    const result = await call();

    expect(result.ok && result.data).toEqual([]);
  });

  it('omits a publish with no daily metrics, keeps one that has them', async () => {
    state.totals = new Map([['pub-measured', { views: 500 }]]);

    const result = await call();

    expect(result.ok && result.data.map((row) => row.publishId)).toEqual([
      'pub-measured',
    ]);
  });

  it('reports a measured zero, which is a figure and belongs', async () => {
    // Distinct from the case above: this video *was* measured and earned
    // nothing. Dropping it would hide a real result.
    state.totals = new Map([['pub-measured', { views: 0 }]]);

    const result = await call();

    expect(result.ok && result.data).toHaveLength(1);
    expect(result.ok && result.data[0]!.views).toBe(0);
  });

  it('leaves cliff null for a measured video with no curve', async () => {
    state.totals = new Map([['pub-measured', { views: 500 }]]);

    const result = await call();

    expect(result.ok && result.data[0]!.cliff).toBeNull();
  });
});

describe('getWeeklyDiagnosticsAction — the channel filter', () => {
  beforeEach(() => {
    state.publishes = [];
    state.filters = [];
  });

  it('filters the publish read by the channel the scope names', async () => {
    // `assertScopeAccess` validates that a connectionId belongs to the
    // caller, so a scope carrying one passed the check and then answered
    // for every channel — scoped in appearance only.
    await getWeeklyDiagnosticsAction({
      scope: { projectId: PROJECT, connectionId: CONNECTION },
      sinceDays: 7,
      limit: 25,
    });

    expect(state.filters).toContainEqual([
      'platform_connection_id',
      CONNECTION,
    ]);
  });

  it('does not filter by channel when the scope names none', async () => {
    await getWeeklyDiagnosticsAction({
      scope: { projectId: PROJECT },
      sinceDays: 7,
      limit: 25,
    });

    expect(state.filters.map(([column]) => column)).not.toContain(
      'platform_connection_id',
    );
  });
});
