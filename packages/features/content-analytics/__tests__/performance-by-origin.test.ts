import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1912: the per-video read past performance and the origin split
 * share, and the split itself. With ClickHouse off nothing is read past
 * the coverage check and the answer is "unmeasured" with its reason; a
 * velocity that is not yet knowable is null, never zero; episodes are
 * split by the origin their story was stamped with, within one platform
 * and content type, as medians with their counts.
 */

const mocks = vi.hoisted(() => ({
  coverage: vi.fn(),
  videoLog: vi.fn(),
}));

vi.mock('../src/server/coverage-service', () => ({
  getCoverageMatrixService: mocks.coverage,
}));

vi.mock('../src/server/video-log-service', async (original) => ({
  ...(await original<typeof import('../src/server/video-log-service')>()),
  getVideoLogService: mocks.videoLog,
}));

const PROJECT = '19120000-0000-4000-8000-000000000001';

type Row = Record<string, unknown>;

/** Answers `.from(table)` with its rows narrowed by `.in()`; one page. */
function fakeClient(tables: Record<string, Row[]>) {
  const reads: string[] = [];

  return {
    reads,
    from(table: string) {
      reads.push(table);
      let rows = tables[table] ?? [];
      let page = 0;
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return chain;
        },
        range: (from: number) => {
          page = from;
          return chain;
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: page > 0 ? [] : rows, error: null }),
      };
      return chain;
    },
  };
}

function logRow(
  n: number,
  platform: string,
  retention: number | null,
  views: number | null,
  mature = true,
) {
  return {
    videoId: `pub-${platform}-${n}`,
    title: `Video ${n}`,
    publishedAt: `2026-09-${String(n).padStart(2, '0')} 12:00:00`,
    channelName: 'Channel',
    platform,
    contentType: platform === 'youtube' ? 'long_form' : 'short',
    language: null,
    viewsAtAge: { 7: views },
    matureAt: { 7: mature },
    predatesIngestAt: { 7: false },
    lifetimeViews: views,
    ingestLagDays: 0,
    impressions: 0,
    ctr: 0,
    avgViewDurationSeconds: null,
    avgViewPercentage: retention,
    revenue: [],
    analyticsNote: null,
    analyticsNoteUpdatedAt: null,
    canEditNote: false,
  };
}

const coverage = (observed: boolean, channels = 1) => ({
  window: { from: '2026-09-03', to: '2026-10-03' },
  observed,
  channels: Array.from({ length: channels }, (_, i) => ({
    connectionId: `c${i}`,
    platform: 'youtube',
    isActive: true,
  })),
  matrix: {
    engagement: {
      youtube: observed
        ? { kind: 'covered', rows: 10, latestDate: '2026-10-01', stale: false }
        : null,
    },
  },
});

beforeEach(() => {
  mocks.coverage.mockReset();
  mocks.videoLog.mockReset();
});

describe('readProjectVideoPerformance (FILM-1912)', () => {
  it('with ClickHouse off, says so and reads no videos', async () => {
    const { readProjectVideoPerformance, NOT_MEASURED_REASON } = await import(
      '../src/server/performance-reader'
    );
    mocks.coverage.mockResolvedValue(coverage(false));
    const client = fakeClient({});

    const reading = await readProjectVideoPerformance(client as never, PROJECT);

    expect(reading).toEqual({
      status: 'unmeasured',
      reason: NOT_MEASURED_REASON,
    });
    expect(mocks.videoLog).not.toHaveBeenCalled();
    expect(client.reads).toEqual([]);
  });

  it('with no channel connected, says so rather than reporting an empty project', async () => {
    const { readProjectVideoPerformance, NO_CHANNEL_REASON } = await import(
      '../src/server/performance-reader'
    );
    mocks.coverage.mockResolvedValue(coverage(true, 0));

    expect(
      await readProjectVideoPerformance(fakeClient({}) as never, PROJECT),
    ).toEqual({ status: 'unmeasured', reason: NO_CHANNEL_REASON });
  });

  it('keeps a velocity that is not yet knowable null, and maps each video to its episode', async () => {
    const { readProjectVideoPerformance } = await import(
      '../src/server/performance-reader'
    );
    mocks.coverage.mockResolvedValue(coverage(true));
    mocks.videoLog.mockResolvedValue([
      logRow(1, 'youtube', 52, 400),
      logRow(2, 'youtube', 48, 900, false),
    ]);
    const client = fakeClient({
      publishes: [
        { id: 'pub-youtube-1', episode_id: 'e1' },
        { id: 'pub-youtube-2', episode_id: null },
      ],
    });

    const reading = await readProjectVideoPerformance(client as never, PROJECT);

    if (reading.status !== 'measured') throw new Error('unmeasured');
    expect(reading.videos).toEqual([
      expect.objectContaining({
        publishId: 'pub-youtube-1',
        episodeId: 'e1',
        retentionPercent: 52,
        viewsFirstWeek: 400,
      }),
      expect.objectContaining({
        publishId: 'pub-youtube-2',
        episodeId: null,
        retentionPercent: 48,
        viewsFirstWeek: null,
      }),
    ]);
    expect(reading.velocityDays).toBe(7);
    expect(reading.freshness).toEqual([
      { platform: 'youtube', latestDate: '2026-10-01', stale: false },
    ]);
    expect(mocks.videoLog.mock.calls[0]![1]).toMatchObject({
      projectId: PROJECT,
      checkpoints: [7],
      orderBy: 'published_at',
      orderDirection: 'desc',
    });
  });
});

describe('getPerformanceByOriginService (FILM-1912)', () => {
  it('splits a hand-computed project by the origin each story was stamped with', async () => {
    const { getPerformanceByOriginService } = await import(
      '../src/server/origin-split-service'
    );
    mocks.coverage.mockResolvedValue(coverage(true));
    // YouTube long-form: e1, e2 server; e3, e4, e5 external; e6 unrecorded.
    // TikTok short for e1: its own group.
    mocks.videoLog.mockResolvedValue([
      logRow(1, 'youtube', 40, 100),
      logRow(2, 'youtube', 60, 300),
      logRow(3, 'youtube', 50, 200),
      logRow(4, 'youtube', 70, null, false),
      logRow(5, 'youtube', null, 600),
      logRow(6, 'youtube', 45, 50),
      logRow(7, 'tiktok', null, 9000),
    ]);
    const origin = (kind: string) => ({
      story: { kind, at: '2026-09-01T00:00:00Z' },
    });
    const client = fakeClient({
      publishes: [1, 2, 3, 4, 5, 6]
        .map((n) => ({
          id: `pub-youtube-${n}`,
          episode_id: `e${n}`,
        }))
        .concat({ id: 'pub-tiktok-7', episode_id: 'e1' }),
      episodes: [
        { id: 'e1', generation_origin: origin('server') },
        { id: 'e2', generation_origin: origin('server') },
        { id: 'e3', generation_origin: origin('external') },
        { id: 'e4', generation_origin: origin('external') },
        { id: 'e5', generation_origin: { screenplay: { kind: 'external' } } },
        { id: 'e6', generation_origin: {} },
      ],
    });

    const result = await getPerformanceByOriginService(client as never, {
      projectId: PROJECT,
      stage: 'story',
    });

    if (result.status !== 'measured') throw new Error('unmeasured');
    expect(result.groups).toEqual([
      {
        platform: 'tiktok',
        contentType: 'short',
        origins: [
          {
            origin: 'server',
            videos: 1,
            retentionMedian: null,
            retentionMeasured: 0,
            velocityMedian: 9000,
            velocityMeasured: 1,
          },
        ],
      },
      {
        platform: 'youtube',
        contentType: 'long_form',
        origins: [
          // e1 40/100, e2 60/300
          {
            origin: 'server',
            videos: 2,
            retentionMedian: 50,
            retentionMeasured: 2,
            velocityMedian: 200,
            velocityMeasured: 2,
          },
          // e3 50/200, e4 70/not yet: one velocity, not a zero
          {
            origin: 'external',
            videos: 2,
            retentionMedian: 60,
            retentionMeasured: 2,
            velocityMedian: 200,
            velocityMeasured: 1,
          },
          // e5 stamped only on its screenplay, e6 never: unrecorded for story
          {
            origin: 'unrecorded',
            videos: 2,
            retentionMedian: 45,
            retentionMeasured: 1,
            velocityMedian: 325,
            velocityMeasured: 2,
          },
        ],
      },
    ]);
    expect(result.notes[0]).toMatch(/^Observational/);
  });

  it('with ClickHouse off, is unmeasured with its reason and reads no episodes', async () => {
    const { getPerformanceByOriginService } = await import(
      '../src/server/origin-split-service'
    );
    const { NOT_MEASURED_REASON } = await import(
      '../src/server/performance-reader'
    );
    mocks.coverage.mockResolvedValue(coverage(false));
    const client = fakeClient({});

    expect(
      await getPerformanceByOriginService(client as never, {
        projectId: PROJECT,
        stage: 'story',
      }),
    ).toEqual({ status: 'unmeasured', reason: NOT_MEASURED_REASON });
    expect(client.reads).toEqual([]);
  });
});
