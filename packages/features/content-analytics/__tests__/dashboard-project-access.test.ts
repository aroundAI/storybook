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
  project: { account_id: string } | null;
  hasAccess: boolean;
  clickHouseCalls: string[];
} = { project: null, hasAccess: false, clickHouseCalls: [] };

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.project, error: null }),
          // `single()`, used for the project row read after the check.
          single: async () => ({ data: state.project, error: null }),
        }),
        is: () => ({
          order: () => ({
            order: () => ({ range: async () => ({ data: [], error: null }) }),
          }),
        }),
      }),
    }),
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
  state.project = { account_id: 'account-b' };
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

  it('refuses when the project row itself is not readable', async () => {
    state.project = null;
    state.hasAccess = true;

    expect(await getProjectDailyMetrics('missing')).toEqual([]);
    expect(state.clickHouseCalls).toEqual([]);
  });
});
