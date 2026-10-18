import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsClient } from '../src/server/analytics-client';
import {
  UNMEASURED_CLICKHOUSE_OFF,
  figuresUnmeasuredReason,
  getChannelDailyFigures,
  getDataFreshness,
  getVideoAudienceBreakdown,
  getVideoDailyFigures,
  getVideoLifetimeFigures,
} from '../src/server/daily-figures';

/**
 * FILM-1734. The morning report's readers: every id is the caller's before
 * ClickHouse is read, a figure nobody measured is null and never 0, and each
 * row's figures come from the one source it names.
 */

const YT = '11111111-1111-4111-8111-111111111111';
const IG = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const YT_CHANNEL = '55555555-5555-4555-8555-555555555555';
const IG_CHANNEL = '66666666-6666-4666-8666-666666666666';

const NULL_FIGURES = {
  views: null,
  engagedViews: null,
  reach: null,
  likes: null,
  dislikes: null,
  comments: null,
  shares: null,
  saves: null,
  reposts: null,
  watchTimeSeconds: null,
  avgViewDurationSeconds: null,
  avgPercentViewed: null,
  subscribersGained: null,
  subscribersLost: null,
  follows: null,
  profileVisits: null,
  impressions: null,
  impressionCtr: null,
  reelsAvgWatchTimeMs: null,
  reelsSkipRate: null,
  fbViews3s: null,
  fbViewsOrganic: null,
  fbViewsComplete: null,
};

const metricDay = (over: Record<string, unknown>) => ({
  videoId: YT,
  platform: 'youtube',
  date: '2026-10-11',
  metricSource: 'analytics_api',
  views: 100,
  engagedViews: 90,
  accountsReached: null,
  likes: 10,
  dislikes: 2,
  comments: 3,
  shares: 1,
  saves: null,
  reposts: null,
  watchTimeSeconds: 6000,
  avgViewDurationSeconds: 60,
  avgViewPercentage: 50,
  subscribersGained: 4,
  subscribersLost: 1,
  profileVisits: null,
  views3s: null,
  views3sOrganic: null,
  completeViews: null,
  ...over,
});

const snapshot = (over: Record<string, unknown>) => ({
  videoId: YT,
  platform: 'youtube',
  date: '2026-10-11',
  fetchedAt: '2026-10-11 23:00:00',
  source: 'data_api',
  views: 1300,
  likes: 55,
  dislikes: null,
  comments: 10,
  shares: null,
  saves: null,
  reposts: null,
  watchTimeSeconds: null,
  subscribersGained: null,
  accountsReached: null,
  profileVisits: null,
  reelsAvgWatchTimeMs: null,
  reelsSkipRate: null,
  views3s: null,
  views3sOrganic: null,
  completeViews: null,
  ...over,
});

const { state, read } = vi.hoisted(() => {
  const state = {
    enabled: true,
    /** The rows RLS lets the caller read, by table. */
    tables: {} as Record<string, unknown[]>,
    /** `has_account_access` per account. */
    access: {} as Record<string, boolean>,
    /** Every ClickHouse read made. */
    reads: [] as string[],
    metricDays: [] as unknown[],
    snapshots: [] as unknown[],
    latest: [] as unknown[],
    totals: [] as unknown[],
    reachDays: [] as unknown[],
    reachTotals: [] as unknown[],
    channelMetrics: [] as unknown[],
    anchors: [] as unknown[],
    channelReach: [] as unknown[],
    audience: {} as Record<string, unknown[]>,
  };

  const read =
    <T>(name: string, rows: () => T) =>
    async () => {
      state.reads.push(name);
      return rows();
    };

  return { state, read };
});

vi.mock('@kit/clickhouse/server', () => ({
  isClickHouseEnabled: () => state.enabled,
  queryVideoMetricDays: read('metricDays', () => state.metricDays),
  queryVideoSnapshotDays: read('snapshots', () => state.snapshots),
  queryLatestVideoSnapshots: read('latest', () => state.latest),
  queryVideoMetricTotals: read('totals', () => state.totals),
  queryVideoReachDays: read('reachDays', () => state.reachDays),
  queryVideoReachTotals: read('reachTotals', () => state.reachTotals),
  queryChannelMetricsDays: read('channelMetrics', () => state.channelMetrics),
  queryChannelSubscriberDays: read('anchors', () => state.anchors),
  queryChannelReach: read('channelReach', () => state.channelReach),
  queryAudienceRows: async (input: { dimension: string }) => {
    state.reads.push(`audience:${input.dimension}`);
    return state.audience[input.dimension] ?? [];
  },
}));

/** Pages hand their builder a client chain; the chain says which table. */
vi.mock('@kit/shared/pagination', () => {
  const rowsOf = (built: unknown) =>
    state.tables[(built as { table: string }).table] ?? [];

  return {
    fetchAllRows: async (page: (from: number, to: number) => unknown) =>
      rowsOf(page(0, 999)),
    fetchAllByIds: async (
      ids: string[],
      page: (chunk: string[], from: number, to: number) => unknown,
    ) =>
      (rowsOf(page(ids, 0, 999)) as Array<{ id: string }>).filter((row) =>
        ids.includes(row.id),
      ),
  };
});

function fakeClient(): AnalyticsClient {
  const chain = (table: string) => {
    const self: Record<string, unknown> = { table };
    for (const method of ['select', 'eq', 'in', 'not', 'order', 'range']) {
      self[method] = () => self;
    }
    self.maybeSingle = async () => ({
      data: (state.tables[table] ?? [])[0] ?? null,
      error: null,
    });
    return self;
  };

  return {
    from: chain,
    rpc: async (_name: string, args: { p_account_id: string }) => ({
      data: state.access[args.p_account_id] ?? false,
      error: null,
    }),
  } as unknown as AnalyticsClient;
}

const publishRow = (id: string, platform: string, connection: string) => ({
  id,
  platform,
  platform_connection_id: connection,
  episodes: { project_id: PROJECT, projects: { account_id: ACCOUNT } },
});

beforeEach(() => {
  Object.assign(state, {
    enabled: true,
    tables: {
      publishes: [
        publishRow(YT, 'youtube', YT_CHANNEL),
        publishRow(IG, 'instagram', IG_CHANNEL),
      ],
      platform_connections: [
        { id: YT_CHANNEL, platform: 'youtube', account_id: ACCOUNT },
        { id: IG_CHANNEL, platform: 'instagram', account_id: ACCOUNT },
      ],
      projects: [{ account_id: ACCOUNT }],
    },
    access: { [ACCOUNT]: true },
    reads: [],
    metricDays: [],
    snapshots: [],
    latest: [],
    totals: [],
    reachDays: [],
    reachTotals: [],
    channelMetrics: [],
    anchors: [],
    channelReach: [],
    audience: {},
  });
});

const client = fakeClient();
const day = { from: '2026-10-11', to: '2026-10-11' };

describe('every id is the caller’s before ClickHouse is read', () => {
  it('refuses the whole read when one publish is not visible, and reads nothing', async () => {
    state.tables.publishes = [publishRow(YT, 'youtube', YT_CHANNEL)];

    await expect(
      getVideoDailyFigures(client, { publishIds: [YT, IG], ...day }),
    ).rejects.toThrow('not in your library');
    expect(state.reads).toEqual([]);
  });

  it('refuses a publish RLS returns but whose account is not the caller’s (a public project)', async () => {
    state.access = {};

    await expect(
      getVideoLifetimeFigures(client, {
        publishIds: [YT],
        asOf: '2026-10-12T00:00:00Z',
      }),
    ).rejects.toThrow('not in your library');
    expect(state.reads).toEqual([]);
  });

  it('refuses a channel in another account', async () => {
    state.access = {};

    await expect(
      getChannelDailyFigures(client, { connectionIds: [YT_CHANNEL], ...day }),
    ).rejects.toThrow('not in your library');
    expect(state.reads).toEqual([]);
  });
});

describe('with the store off, every figure is null and says why', () => {
  it('a row per video and day, nothing measured, never 0', async () => {
    state.enabled = false;

    const rows = await getVideoDailyFigures(client, {
      publishIds: [YT, IG],
      from: '2026-10-10',
      to: '2026-10-11',
    });

    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toMatchObject(NULL_FIGURES);
    expect(rows.map((r) => r.source)).toEqual([
      'analytics_api',
      'analytics_api',
      'graph_api',
      'graph_api',
    ]);
    expect(figuresUnmeasuredReason()).toBe(UNMEASURED_CLICKHOUSE_OFF);
    expect(state.reads).toEqual([]);
  });
});

describe('getVideoDailyFigures', () => {
  it('keeps each source’s figures on its own row, and never merges across them', async () => {
    state.metricDays = [
      metricDay({}),
      metricDay({ date: '2026-10-10', metricSource: 'reporting_api' }),
    ];
    state.snapshots = [
      snapshot({ date: '2026-10-10', views: 1000, likes: 50, dislikes: 4 }),
      snapshot({}),
    ];
    state.reachDays = [
      {
        videoId: YT,
        date: '2026-10-10',
        impressions: 2000,
        impressionsCtr: 0.05,
      },
    ];

    const rows = await getVideoDailyFigures(client, {
      publishIds: [YT],
      from: '2026-10-10',
      to: '2026-10-11',
    });

    expect(rows.map((r) => [r.date, r.source])).toEqual([
      ['2026-10-10', 'reporting_csv'],
      ['2026-10-11', 'analytics_api'],
      ['2026-10-11', 'data_api'],
    ]);
    // The CSV's day carries its impressions; the Analytics API's none.
    expect(rows[0]).toMatchObject({ impressions: 2000, impressionCtr: 0.05 });
    expect(rows[1]).toMatchObject({
      views: 100,
      dislikes: 2,
      subscribersGained: 4,
      follows: null,
      impressions: null,
    });
  });

  it('a Data API day is the change between two snapshots; a side that withheld a count makes it null, not 0', async () => {
    state.snapshots = [
      snapshot({ date: '2026-10-10', views: 1000, likes: 50, dislikes: 4 }),
      snapshot({ views: 1300, likes: 48, dislikes: null }),
    ];

    const [row] = await getVideoDailyFigures(client, {
      publishIds: [YT],
      ...day,
    });

    expect(row).toMatchObject({
      source: 'data_api',
      views: 300,
      // Likes taken back are a fall, reported as one.
      likes: -2,
      dislikes: null,
      comments: 0,
      watchTimeSeconds: null,
    });
  });

  it('no row for a day whose previous snapshot is missing', async () => {
    state.snapshots = [snapshot({})];

    expect(
      await getVideoDailyFigures(client, { publishIds: [YT], ...day }),
    ).toEqual([]);
  });

  it('Instagram follows are follows, not subscribers gained', async () => {
    state.metricDays = [
      metricDay({
        videoId: IG,
        platform: 'instagram',
        metricSource: 'snapshot_delta',
        subscribersGained: 3,
        profileVisits: 7,
        dislikes: null,
      }),
    ];

    const [row] = await getVideoDailyFigures(client, {
      publishIds: [IG],
      ...day,
    });

    expect(row).toMatchObject({
      source: 'graph_api',
      follows: 3,
      subscribersGained: null,
      profileVisits: 7,
      dislikes: null,
    });
  });

  it('asks for at most 400 days', async () => {
    await expect(
      getVideoDailyFigures(client, {
        publishIds: [YT],
        from: '2025-01-01',
        to: '2026-10-11',
      }),
    ).rejects.toThrow('at most 400 days');
  });
});

describe('getVideoLifetimeFigures', () => {
  it('the live counts, the summed days and the impressions, each from its source', async () => {
    state.latest = [snapshot({ dislikes: 9 })];
    state.totals = [
      {
        videoId: YT,
        platform: 'youtube',
        lastDate: '2026-10-11',
        views: 400,
        engagedViews: 380,
        likes: 30,
        dislikes: 3,
        comments: 8,
        shares: 2,
        watchTimeSeconds: 12000,
        avgViewDurationSeconds: 30,
        avgViewPercentage: 35,
        subscribersGained: 6,
        subscribersLost: 1,
      },
    ];
    state.reachTotals = [
      {
        videoId: YT,
        lastDate: '2026-10-11',
        impressions: 2000,
        impressionsCtr: 0.05,
      },
    ];

    const rows = await getVideoLifetimeFigures(client, {
      publishIds: [YT],
      asOf: '2026-10-12T06:00:00.000Z',
    });

    expect(rows.map((r) => [r.source, r.asOf])).toEqual([
      ['analytics_api', '2026-10-11'],
      ['data_api', '2026-10-11T23:00:00Z'],
      ['reporting_csv', '2026-10-11'],
    ]);
    expect(rows[1]).toMatchObject({ views: 1300, dislikes: 9, shares: null });
    expect(rows[0]).toMatchObject({
      avgViewDurationSeconds: 30,
      impressions: null,
    });
  });
});

describe('getChannelDailyFigures', () => {
  it('the channel day, its lifetime statistics and an Instagram day’s reach', async () => {
    const channelRow = (over: Record<string, unknown>) => ({
      connectionId: YT_CHANNEL,
      platform: 'youtube',
      date: '2026-10-11',
      views: null,
      watchTimeSeconds: null,
      likes: null,
      dislikes: null,
      comments: null,
      shares: null,
      subscribersGained: null,
      subscribersLost: null,
      lifetimeViews: null,
      lifetimeSubscribers: null,
      lifetimeVideos: null,
      ...over,
    });
    state.channelMetrics = [
      channelRow({ source: 'analytics_api', views: 5000, dislikes: 6 }),
      channelRow({
        source: 'data_api',
        lifetimeViews: 90000,
        lifetimeVideos: 30,
      }),
      channelRow({
        connectionId: IG_CHANNEL,
        platform: 'instagram',
        source: 'graph_api',
        views: 800,
      }),
    ];
    state.anchors = [
      { connectionId: YT_CHANNEL, date: '2026-10-11', subscribers: 1200 },
    ];
    state.channelReach = [
      {
        asOf: '2026-10-11',
        accountsReached: 77,
        followers: null,
        nonFollowers: null,
      },
    ];

    const rows = await getChannelDailyFigures(client, {
      connectionIds: [YT_CHANNEL, IG_CHANNEL],
      ...day,
    });

    expect(rows.map((r) => [r.platform, r.source])).toEqual([
      ['youtube', 'analytics_api'],
      ['youtube', 'data_api'],
      ['instagram', 'graph_api'],
    ]);
    expect(rows[0]).toMatchObject({
      views: 5000,
      dislikes: 6,
      subscribersTotal: null,
    });
    expect(rows[1]).toMatchObject({
      subscribersTotal: 1200,
      lifetimeViews: 90000,
      lifetimeVideos: 30,
      views: null,
    });
    expect(rows[2]).toMatchObject({
      accountViews: 800,
      reach: 77,
      views: null,
    });
  });
});

describe('getVideoAudienceBreakdown', () => {
  it('nulls the figure a platform does not report, and says whose share Instagram’s is', async () => {
    state.audience = {
      age_group: [
        { videoId: YT, key: 'age25-34', views: 0, percentage: 40 },
        { videoId: IG, key: '25-34', views: 120, percentage: 0 },
      ],
      city: [{ videoId: YT, key: 'London', views: 50, percentage: 0 }],
    };

    const breakdown = await getVideoAudienceBreakdown(client, {
      publishIds: [YT, IG],
    });

    expect(breakdown.age).toEqual([
      {
        publishId: YT,
        platform: 'youtube',
        key: 'age25-34',
        views: null,
        percentage: 40,
        basis: 'viewers',
      },
      {
        publishId: IG,
        platform: 'instagram',
        key: '25-34',
        views: 120,
        percentage: null,
        basis: 'followers',
      },
    ]);
    expect(breakdown.city[0]).toMatchObject({ views: 50, percentage: null });
    expect(breakdown.os).toEqual([]);
  });
});

describe('getDataFreshness', () => {
  it('per channel: the newest data day, the last sync, and whether to reconnect', async () => {
    const synced = (
      id: string,
      sync: Record<string, unknown>,
      platform = 'youtube',
      connection = YT_CHANNEL,
    ) => ({
      id,
      platform,
      platform_connection_id: connection,
      metadata: { sync },
      platform_connections: {
        scopes: null,
        metadata: null,
        disconnected_at: null,
      },
    });
    state.tables.publishes = [
      synced('a', {
        last_sync_status: 'success',
        last_synced_at: '2026-10-11T10:00:00Z',
        last_data_date: '2026-10-09',
      }),
      synced('b', {
        last_sync_status: 'failed',
        last_error: 'quota',
        last_synced_at: '2026-10-10T10:00:00Z',
        last_failed_at: '2026-10-11T11:00:00Z',
        last_data_date: '2026-10-10',
      }),
      synced(
        'c',
        { last_sync_status: 'scope_error', requires_reauth: true },
        'instagram',
        IG_CHANNEL,
      ),
    ];

    expect(await getDataFreshness(client, { projectId: PROJECT })).toEqual([
      {
        connectionId: YT_CHANNEL,
        platform: 'youtube',
        lastDataDate: '2026-10-10',
        lastSyncAt: '2026-10-11T10:00:00Z',
        status: 'failed',
        error: 'quota',
        needsReauth: false,
      },
      {
        connectionId: IG_CHANNEL,
        platform: 'instagram',
        lastDataDate: null,
        lastSyncAt: null,
        status: 'scope_error',
        error: null,
        needsReauth: true,
      },
    ]);
  });
});
