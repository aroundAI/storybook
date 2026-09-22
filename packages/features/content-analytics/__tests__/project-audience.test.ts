import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudienceDimension } from '@kit/clickhouse/server';

import { getProjectAudienceData } from '../src/server/aggregation-queries';

/**
 * The Audience tab's one read (FILM-1701).
 *
 * Device Type was rendered from a constant — `{ mobile: 78, desktop: 18,
 * tablet: 4 }` — while `buildAudienceRows` had been writing real
 * `dimension = 'device'` rows that nothing asked for. These pin the read to
 * the rows: what is there is pooled by views, and what is not there is
 * absent rather than zero.
 */
interface Row {
  videoId: string;
  key: string;
  views: number;
  percentage: number;
}

const state: {
  rows: Partial<Record<AudienceDimension, Row[]>>;
  views: Record<string, number>;
  asked: AudienceDimension[];
} = { rows: {}, views: {}, asked: [] };

function builder(rows: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    // Honours the range: `fetchAllRows` pages until a page comes back empty,
    // so a mock that ignores it never terminates.
    range: async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: () => builder([{ id: 'video-a' }, { id: 'video-b' }]),
  }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  queryAudienceRows: async (input: { dimension: AudienceDimension }) => {
    state.asked.push(input.dimension);

    return state.rows[input.dimension] ?? [];
  },
  queryDailyTimeSeries: async () => [],
  queryDailyTimeSeriesByPlatform: async () => [],
  queryPlatformBreakdown: async () => [],
  queryTotalsByVideoIds: async () =>
    new Map(
      Object.entries(state.views).map(([videoId, views]) => [
        videoId,
        { views },
      ]),
    ),
}));

const device = (videoId: string, key: string, views: number): Row => ({
  videoId,
  key,
  views,
  percentage: 0,
});

const share = (videoId: string, key: string, percentage: number): Row => ({
  videoId,
  key,
  views: 0,
  percentage,
});

beforeEach(() => {
  state.rows = {};
  state.views = { 'video-a': 1_000, 'video-b': 3_000 };
  state.asked = [];
});

describe('getProjectAudienceData — Device Type', () => {
  it("reads video_audience's device dimension", async () => {
    await getProjectAudienceData('project');

    expect(state.asked).toContain('device');
  });

  it('pools device views across videos, rather than averaging their shares', async () => {
    state.rows.device = [
      device('video-a', 'MOBILE', 600),
      device('video-a', 'DESKTOP', 300),
      device('video-a', 'TV', 100),
      device('video-b', 'MOBILE', 900),
      device('video-b', 'DESKTOP', 1_500),
      device('video-b', 'TABLET', 600),
    ];

    const audience = await getProjectAudienceData('project');

    // 4,000 views carry a device. A mean of the two videos' own shares would
    // put mobile at 45%; the old literal put it at 78%.
    expect(audience?.deviceType).toEqual({
      totalViews: 4_000,
      devices: [
        { device: 'DESKTOP', views: 1_800, percentage: 45 },
        { device: 'MOBILE', views: 1_500, percentage: 37.5 },
        { device: 'TABLET', views: 600, percentage: 15 },
        { device: 'TV', views: 100, percentage: 2.5 },
      ],
    });
  });

  it('is a project with an audience when device rows are all it has', async () => {
    state.rows.device = [device('video-a', 'MOBILE', 10)];

    const audience = await getProjectAudienceData('project');

    expect(audience).not.toBeNull();
    expect(audience?.deviceType?.devices).toHaveLength(1);
  });

  it('reports no device breakdown when there are no device rows — not a zero, not a default', async () => {
    state.rows.gender = [share('video-a', 'male', 60)];

    const audience = await getProjectAudienceData('project');

    expect(audience).not.toBeNull();
    expect(audience).not.toHaveProperty('deviceType');
  });

  it('reports no device breakdown when every device row counts zero views', async () => {
    // A share of nothing is 0/0. Rendering that as "0%" three times would be
    // three measurements nobody made.
    state.rows.gender = [share('video-a', 'male', 60)];
    state.rows.device = [device('video-a', 'MOBILE', 0)];

    const audience = await getProjectAudienceData('project');

    expect(audience).not.toHaveProperty('deviceType');
  });
});

describe('getProjectAudienceData — the unit every card renders', () => {
  it('returns percentages out of 100, weighted by each video’s views', async () => {
    // The cards print the number followed by "%". A 0..1 fraction here put
    // "0.3%" on screen for a 30% share.
    state.rows.gender = [
      share('video-a', 'male', 60),
      share('video-a', 'female', 40),
      share('video-b', 'male', 20),
      share('video-b', 'female', 80),
    ];
    state.rows.country = [
      device('video-a', 'US', 700),
      device('video-a', 'IN', 300),
      device('video-b', 'US', 300),
      device('video-b', 'IN', 2_700),
    ];

    const audience = await getProjectAudienceData('project');

    // (60% of 1,000 + 20% of 3,000) / 4,000 — a plain mean would say 40.
    expect(audience?.demographics?.genders).toEqual({ male: 30, female: 70 });
    expect(audience?.geography).toEqual({ US: 25, IN: 75 });
  });
});
