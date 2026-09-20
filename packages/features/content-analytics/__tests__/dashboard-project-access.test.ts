import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getProjectAnalytics,
  getProjectDailyMetrics,
} from '../src/server/aggregation-queries';

/**
 * The dashboard's two project reads check membership before they touch
 * ClickHouse, which has no row-level security (FILM-1615 EDD, F-0).
 *
 * These were covered only by a browser spec, and could not be. The daily
 * metrics query runs under `enabled: activeTab === 'overview'`, and the
 * spec that drove it clicked through to the Deep Dive — so whether the
 * request happened at all before the assertions ran was a race, and the
 * mutation guard for this check passed in CI while the check was removed.
 * A read that decides who may see another tenant's figures is not a thing
 * to test by hoping a tab was still open.
 */
const state: {
  project: { account_id: string; id?: string; name?: string } | null;
  hasAccess: boolean;
  clickHouseCalls: string[];
} = { project: null, hasAccess: false, clickHouseCalls: [] };

/**
 * A PostgREST-shaped builder: every filter returns itself, and only the
 * terminal calls resolve. The reads under test chain different lengths —
 * the project row ends at `single()`, the seasons list at `range()` — and a
 * mock shaped to one of them fails the other for a reason that has nothing
 * to do with access.
 */
function builder(row: unknown, rows: unknown[] = []) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    range: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
    single: async () => ({ data: row, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) =>
      table === 'projects' ? builder(state.project) : builder(null, []),
    rpc: async () => ({ data: state.hasAccess, error: null }),
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryAudienceRows: async () => [],
  queryDailyTimeSeries: async () => [],
  queryDailyTimeSeriesByPlatform: async () => {
    state.clickHouseCalls.push('queryDailyTimeSeriesByPlatform');
    return [{ date: '2026-09-15', views: 777_777 }];
  },
  queryPlatformBreakdown: async () => {
    state.clickHouseCalls.push('queryPlatformBreakdown');
    return [];
  },
  queryTotalsByVideoIds: async () => new Map(),
}));

beforeEach(() => {
  state.project = {
    account_id: 'account-b',
    id: 'project-of-account-b',
    name: 'Account B project',
  };
  state.hasAccess = false;
  state.clickHouseCalls = [];
});

describe('the dashboard reads, against a project the caller cannot access', () => {
  it('returns no daily metrics, and does not ask ClickHouse for them', async () => {
    // The row is readable — a public project is readable by anyone signed
    // in — and that is exactly what must not count as access.
    const metrics = await getProjectDailyMetrics('project-of-account-b');

    expect(metrics).toEqual([]);
    expect(state.clickHouseCalls).toEqual([]);
  });

  it('returns no project analytics', async () => {
    expect(await getProjectAnalytics('project-of-account-b')).toBeNull();
    expect(state.clickHouseCalls).toEqual([]);
  });

  it('reads the metrics for a caller who does have a role on the account', async () => {
    state.hasAccess = true;

    const metrics = await getProjectDailyMetrics('project-of-account-b');

    expect(metrics).toEqual([{ date: '2026-09-15', views: 777_777 }]);
    expect(state.clickHouseCalls).toEqual(['queryDailyTimeSeriesByPlatform']);
  });

  it('reads the analytics for a caller who does have a role on the account', async () => {
    // The refusal cases alone would pass just as happily against a read
    // that always refuses, which is half the behaviour unguarded.
    state.hasAccess = true;

    const analytics = await getProjectAnalytics('project-of-account-b');

    expect(analytics).toMatchObject({
      projectId: 'project-of-account-b',
      projectName: 'Account B project',
    });
    expect(state.clickHouseCalls).toContain('queryPlatformBreakdown');
  });

  it('refuses when the project row itself is not readable', async () => {
    state.project = null;
    state.hasAccess = true;

    expect(await getProjectDailyMetrics('missing')).toEqual([]);
    expect(state.clickHouseCalls).toEqual([]);
  });
});
