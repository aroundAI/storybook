import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getEpisodeRetentionCurveService } from '../src/server/diagnostics-service';

/**
 * FILM-2001: the edit package's retention hints come through this service,
 * which StorybookStudio reads as "markers on the timeline". Four answers,
 * none of them a zero: ClickHouse off, no published YouTube video, a video
 * whose curve has not been fetched, and a curve. The episode and publish
 * are resolved on the caller's client (RLS), and every ClickHouse read is
 * keyed on a publish that read let through.
 */

const EPISODE = '11111111-2001-4000-8000-000000000001';
const PUBLISH = '22222222-2001-4000-8000-000000000002';
const PROJECT = '33333333-2001-4000-8000-000000000003';

const state = {
  enabled: true,
  publishes: [] as Array<{ id: string }>,
  curve: [] as Array<{ elapsedRatio: number; audienceWatchRatio: number }>,
  fetched: null as { asOf: string; platform: string } | null,
  clickhouseCalls: [] as Array<{
    name: string;
    videoId: string;
    projectIds?: string[];
  }>,
};

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@kit/clickhouse/server', () => ({
  isClickHouseEnabled: () => state.enabled,
  queryRetentionCurve: async (input: {
    videoId: string;
    projectIds?: string[];
  }) => {
    state.clickhouseCalls.push({ name: 'curve', ...input });
    return state.curve;
  },
  queryRetentionCurveFetchedAt: async (input: {
    videoId: string;
    projectIds?: string[];
  }) => {
    state.clickhouseCalls.push({ name: 'fetchedAt', ...input });
    return state.fetched;
  },
  queryRetentionCurves: vi.fn(),
  queryQualityMetricsForVideos: vi.fn(),
  queryTotalsByVideoIds: vi.fn(),
}));

function client() {
  const rows: Record<string, () => unknown> = {
    publishes: () => state.publishes,
    'publishes:single': () =>
      state.publishes[0]
        ? {
            id: PUBLISH,
            duration_seconds: 300,
            episodes: { project_id: PROJECT },
          }
        : null,
    'episodes:single': () => ({ project_id: PROJECT }),
  };

  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: rows[table]!(), error: null }),
        maybeSingle: async () => ({
          data: rows[`${table}:single`]!(),
          error: null,
        }),
      };
      return chain;
    },
  } as never;
}

beforeEach(() => {
  state.enabled = true;
  state.publishes = [{ id: PUBLISH }];
  state.curve = [
    { elapsedRatio: 0, audienceWatchRatio: 1 },
    { elapsedRatio: 0.5, audienceWatchRatio: 0.6 },
  ];
  state.fetched = { asOf: '2026-10-03T06:00:00Z', platform: 'youtube' };
  state.clickhouseCalls = [];
});

describe('getEpisodeRetentionCurveService', () => {
  it('is unmeasured with ClickHouse off, and reads nothing', async () => {
    state.enabled = false;

    expect(
      await getEpisodeRetentionCurveService(client(), { episodeId: EPISODE }),
    ).toEqual({ state: 'unmeasured' });
    expect(state.clickhouseCalls).toEqual([]);
  });

  it('says there is no published video, rather than an empty curve', async () => {
    state.publishes = [];

    expect(
      await getEpisodeRetentionCurveService(client(), { episodeId: EPISODE }),
    ).toEqual({ state: 'no_published_video' });
    expect(state.clickhouseCalls).toEqual([]);
  });

  it('says no curve has been fetched for a published video', async () => {
    state.curve = [];
    state.fetched = null;

    expect(
      await getEpisodeRetentionCurveService(client(), { episodeId: EPISODE }),
    ).toEqual({ state: 'no_curve', publishId: PUBLISH });
  });

  it('returns the curve with its as-of date, the video length and the platform', async () => {
    expect(
      await getEpisodeRetentionCurveService(client(), { episodeId: EPISODE }),
    ).toEqual({
      state: 'curve',
      publishId: PUBLISH,
      platform: 'youtube',
      asOf: '2026-10-03T06:00:00Z',
      durationSeconds: 300,
      points: state.curve,
    });
    // Both ClickHouse reads are keyed on the RLS-visible publish and bounded
    // to its project.
    expect(state.clickhouseCalls).toEqual([
      { name: 'curve', videoId: PUBLISH, projectIds: [PROJECT] },
      { name: 'fetchedAt', videoId: PUBLISH, projectIds: [PROJECT] },
    ]);
  });
});
