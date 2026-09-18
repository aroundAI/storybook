import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getYppProgressAction } from '../src/server/deep-dive-actions';

/**
 * The YPP gate's watch hours do not depend on the subscriber level, so a
 * failed or slow level read must cost only the subscriber row — not the
 * whole card (FILM-1617).
 */

const accountId = '00000000-0000-4000-8000-0000000000b1';
const connectionId = '00000000-0000-4000-8000-0000000000c1';

const mocks = vi.hoisted(() => ({
  queryLatestSubscriberLevels: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryLatestSubscriberLevels: mocks.queryLatestSubscriberLevels,
  queryWatchWindowTotals: async () => ({
    watchTimeSeconds: 36_000,
    netSubscribers: 12,
  }),
  queryChannelWatchWindow: async () => ({ watchTimeSeconds: 0 }),
  computeCohortGrowth: vi.fn(),
  queryBackCatalogShare: vi.fn(),
  queryCohortMedians: vi.fn(),
  queryMedianViewsPerVideo: vi.fn(),
  queryRollingViews: vi.fn(),
  queryTrafficSourceBreakdown: vi.fn(),
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: async () => accountId,
}));

vi.mock('../src/server/channels', () => ({
  listAccountChannels: async () => [
    {
      connectionId,
      platform: 'youtube',
      name: 'Main',
      thumbnailUrl: null,
      isActive: true,
    },
  ],
}));

vi.mock('../src/server/settings-queries', () => ({
  fetchAccountAnalyticsSettings: async () => null,
  fetchChannelAnalyticsOverrides: async () => new Map(),
}));

describe('getYppProgressAction and the subscriber level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the level when the read succeeds', async () => {
    mocks.queryLatestSubscriberLevels.mockResolvedValue(
      new Map([
        [
          connectionId,
          {
            date: '2026-09-17',
            level: 1_200,
            source: 'snapshot',
            roundingStep: 0,
          },
        ],
      ]),
    );

    const [channel] = await getYppProgressAction({
      accountId,
      windowDays: 365,
    });

    expect(channel).toMatchObject({
      subscribers: 1_200,
      subscribersReadFailed: false,
      watchHours: 10,
    });
  });

  it('keeps watch hours when the level read fails', async () => {
    mocks.queryLatestSubscriberLevels.mockRejectedValue(
      new Error('ClickHouse unavailable'),
    );

    const [channel] = await getYppProgressAction({
      accountId,
      windowDays: 365,
    });

    expect(channel).toMatchObject({
      subscribers: null,
      subscribersReadFailed: true,
      watchHours: 10,
    });
  });
});
