import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordViewsDenominator } from '@kit/clickhouse';
import type { PerVideoTotals } from '@kit/clickhouse';
import type { VideoLanguageRow } from '@kit/clickhouse/server';

import {
  getContentTypeComparison,
  getLanguagePerformance,
  getPlatformLanguageMatrix,
  getShortsSourcePerformance,
} from '../src/server/language-analytics';

/**
 * FILM-1732: the Language tab's rates come back recorded. Each figure is
 * the one the read returned before the record was added, and each record
 * names the platforms whose rows were summed and the read's window.
 *
 * The window runs 2026-08-15 to 2026-09-14, across YouTube's 2026-08-27
 * change to what a view is, and the fixture has a Facebook short, whose
 * views are NULL — so it is recorded as not in the denominator.
 *
 * | video   | platform | lang | type  | views | likes | comments | shares | revenue |
 * |---------|----------|------|-------|-------|-------|----------|--------|---------|
 * | yt-long | youtube  | en   | full  | 1,000 |    40 |        8 |      2 |     500 |
 * | yt-shrt | youtube  | en   | short | 4,000 |   200 |       40 |     10 |     120 |
 * | fb-shrt | facebook | en   | short |  null |    30 |        6 |      4 |    null |
 * | tt-shrt | tiktok   | es   | short | 2,000 |   100 |       30 |     30 |    null |
 * | yt-hi   | youtube  | hi   | full  |     — | no rows in the window              |
 */
const START = new Date('2026-08-15T12:00:00Z');
const END = new Date('2026-09-14T12:00:00Z');
const WINDOW = { from: '2026-08-15', to: '2026-09-14' };

const VIDEOS: VideoLanguageRow[] = [
  video('yt-long', 'youtube', 'en', 'full', 1200),
  video('yt-shrt', 'youtube', 'en', 'short', 45),
  video('fb-shrt', 'facebook', 'en', 'short', 45),
  video('tt-shrt', 'tiktok', 'es', 'short', 30),
  video('yt-hi', 'youtube', 'hi', 'full', 1200),
];

const TOTALS: Record<string, PerVideoTotals> = {
  'yt-long': totals(1000, 40, 8, 2, 500),
  'yt-shrt': totals(4000, 200, 40, 10, 120),
  'fb-shrt': totals(null, 30, 6, 4, null),
  'tt-shrt': totals(2000, 100, 30, 30, null),
};

function video(
  videoId: string,
  platform: string,
  language: string,
  contentType: string,
  assetDurationSeconds: number,
): VideoLanguageRow {
  return {
    videoId,
    episodeId: `episode-${videoId}`,
    platform,
    contentType,
    assetDurationSeconds,
    title: `Video ${videoId}`,
    language,
    channelLanguage: language,
  };
}

function totals(
  views: number | null,
  likes: number,
  comments: number,
  shares: number,
  revenue_cents: number | null,
): PerVideoTotals {
  return {
    views,
    likes,
    comments,
    shares,
    saves: 0,
    watch_time_seconds: 0,
    revenue_cents,
    subscribers_gained: 0,
    measured: {
      shares: true,
      saves: false,
      watch_time_seconds: false,
      subscribers_gained: false,
    },
  };
}

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: async () => 'account-1',
}));

vi.mock('@kit/supabase/server-client', () => {
  const chain = {
    select: () => chain,
    in: () => chain,
    order: () => chain,
    range: async (from: number) => ({
      data: from === 0 ? [{ id: 'episode-yt-shrt', title: 'Episode' }] : [],
      error: null,
    }),
  };

  return { getSupabaseServerClient: () => ({ from: () => chain }) };
});

vi.mock('@kit/clickhouse/server', async () => {
  const pure =
    await vi.importActual<typeof import('@kit/clickhouse')>('@kit/clickhouse');

  return {
    LANGUAGE_DIMENSION_SEGMENTS: {
      content: 'language',
      channel: 'channel_language',
    },
    fromDimLanguage: pure.fromDimLanguage,
    // Honours the scope's content type and platform filter, as the dim
    // query does.
    queryVideoLanguages: async (input: {
      scope: { contentType?: string; platforms?: string[] };
    }) =>
      VIDEOS.filter(
        (row) =>
          (!input.scope.contentType ||
            row.contentType === input.scope.contentType) &&
          (!input.scope.platforms ||
            input.scope.platforms.includes(row.platform)),
      ),
    queryTotalsByVideoIds: async (ids: string[]) =>
      new Map(
        ids.flatMap((id) => (TOTALS[id] ? [[id, TOTALS[id]] as const] : [])),
      ),
    querySegmentPerformance: async () => [],
  };
});

const options = { startDate: START, endDate: END };

const denominator = (platforms: string[]) =>
  recordViewsDenominator({ platforms, window: WINDOW });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the fixture’s record (FILM-1732)', () => {
  it('crosses YouTube’s 2026-08-27 change and keeps Facebook out of the denominator', () => {
    const record = denominator(['youtube', 'facebook']);

    expect(record.window).toEqual(WINDOW);
    expect(record.crosses).toHaveLength(1);
    expect(record.crosses[0]?.date).toBe('2026-08-27');
    expect(
      record.platforms.find((part) => part.platform === 'facebook'),
    ).toMatchObject({ inDenominator: false });
  });
});

describe('getLanguagePerformance, recorded (FILM-1732)', () => {
  it('keeps each language’s engagement figure: (likes + comments + shares) / views × 100', async () => {
    const rows = await getLanguagePerformance('project-1', options);
    const byLanguage = new Map(rows.map((row) => [row.language, row]));

    // en: (270 + 54 + 16) / 5,000 — Facebook's views are null and add none.
    expect(byLanguage.get('en')?.engagement?.value).toBeCloseTo(6.8, 10);
    // es: (100 + 30 + 30) / 2,000
    expect(byLanguage.get('es')?.engagement?.value).toBeCloseTo(8, 10);
    // hi: no views in the window: not measured, not 0 (KB-194).
    expect(byLanguage.get('hi')?.engagement).toBeNull();
  });

  it('records the platforms whose rows were summed, over the read’s window', async () => {
    const rows = await getLanguagePerformance('project-1', options);
    const byLanguage = new Map(rows.map((row) => [row.language, row]));

    expect(byLanguage.get('en')?.engagement?.denominator).toEqual(
      denominator(['youtube', 'facebook']),
    );
    expect(byLanguage.get('es')?.engagement?.denominator).toEqual(
      denominator(['tiktok']),
    );
    // A language with no views in the window has no rate to record.
    expect(byLanguage.get('hi')?.engagement).toBeNull();
  });
});

describe('getPlatformLanguageMatrix, recorded (FILM-1732)', () => {
  it('keeps each cell’s engagement figure', async () => {
    const rows = await getPlatformLanguageMatrix('project-1', options);
    const cell = (platform: string) =>
      rows.find((row) => row.platform === platform);

    // youtube × en: (240 + 48 + 12) / 5,000
    expect(cell('youtube')?.engagementRate?.value).toBeCloseTo(6, 10);
    // facebook × en: interactions but no views: not measured (KB-194).
    expect(cell('facebook')?.engagementRate).toBeNull();
    // tiktok × es: (100 + 30 + 30) / 2,000
    expect(cell('tiktok')?.engagementRate?.value).toBeCloseTo(8, 10);
  });

  it('records each cell over its one platform', async () => {
    const rows = await getPlatformLanguageMatrix('project-1', options);

    for (const row of rows.filter((entry) => entry.engagementRate)) {
      expect(row.engagementRate?.denominator).toEqual(
        denominator([row.platform]),
      );
    }
    expect(rows.map((row) => row.platform).sort()).toEqual([
      'facebook',
      'tiktok',
      'youtube',
    ]);
  });
});

describe('getContentTypeComparison, recorded (FILM-1732)', () => {
  it('keeps each family’s engagement and revenue per view', async () => {
    const { families } = await getContentTypeComparison('project-1', options);
    const family = (name: string) =>
      families.find((entry) => entry.family === name);

    // short_vertical: (330 + 76 + 44) / 6,000; revenue 120 / 6,000.
    expect(family('short_vertical')?.engagement?.value).toBeCloseTo(7.5, 10);
    expect(family('short_vertical')?.revenuePerViewCents?.value).toBeCloseTo(
      0.02,
      10,
    );
    // long_horizontal: (40 + 8 + 2) / 1,000; revenue 500 / 1,000.
    expect(family('long_horizontal')?.engagement?.value).toBeCloseTo(5, 10);
    expect(family('long_horizontal')?.revenuePerViewCents?.value).toBeCloseTo(
      0.5,
      10,
    );
  });

  it('records every platform pooled into a family, and returns the window', async () => {
    const comparison = await getContentTypeComparison('project-1', options);
    const family = (name: string) =>
      comparison.families.find((entry) => entry.family === name);
    const shorts = denominator(['youtube', 'facebook', 'tiktok']);

    expect(comparison.window).toEqual(WINDOW);
    expect(family('short_vertical')?.engagement?.denominator).toEqual(shorts);
    expect(family('short_vertical')?.revenuePerViewCents?.denominator).toEqual(
      shorts,
    );
    expect(family('long_horizontal')?.engagement?.denominator).toEqual(
      denominator(['youtube']),
    );
  });

  it('gives no revenue per view where no earnings were measured', async () => {
    const { families } = await getContentTypeComparison('project-1', {
      ...options,
      platforms: ['tiktok'],
    });

    expect(families).toHaveLength(1);
    expect(families[0]?.revenuePerViewCents).toBeNull();
    expect(families[0]?.engagement).toEqual({
      value: 8,
      denominator: denominator(['tiktok']),
    });
  });
});

describe('getShortsSourcePerformance, recorded (FILM-1732)', () => {
  it('keeps the likes-and-comments figure, shares left out (KB-171)', async () => {
    const rows = await getShortsSourcePerformance('project-1', options);
    const short = (id: string) => rows.find((row) => row.publishId === id);

    // (200 + 40) / 4,000
    expect(short('yt-shrt')?.engagement?.value).toBeCloseTo(6, 10);
    // (100 + 30) / 2,000 — the 30 shares are not in it.
    expect(short('tt-shrt')?.engagement?.value).toBeCloseTo(6.5, 10);
    // A Facebook short has no views to divide by.
    expect(short('fb-shrt')?.engagement).toBeNull();
  });

  it('records each short over its own platform and the window', async () => {
    const rows = await getShortsSourcePerformance('project-1', options);
    const short = (id: string) => rows.find((row) => row.publishId === id);

    expect(short('yt-shrt')?.engagement?.denominator).toEqual(
      denominator(['youtube']),
    );
    expect(short('yt-shrt')?.engagement?.denominator.crosses[0]?.date).toBe(
      '2026-08-27',
    );
    expect(short('tt-shrt')?.engagement?.denominator).toEqual(
      denominator(['tiktok']),
    );
  });
});
