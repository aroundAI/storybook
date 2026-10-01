import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfidence } from '@kit/clickhouse';

import { LANGUAGE_NOT_SET_KEY } from '../src/lib/language-labels';
import {
  getContentTypeComparison,
  getLanguageDivergence,
  getLanguagePerformance,
  getLanguageTrend,
  getPlatformLanguageMatrix,
  getShortsSourcePerformance,
} from '../src/server/language-analytics';

/**
 * The Language tab's reads (FILM-1702).
 *
 * The fixture is the one the spec requires: a publish with an explicitly
 * non-English language, one whose language was never set, one routed to a
 * channel whose target differs from its own, and a channel carrying two
 * languages. The figures are chosen so the old behaviour gives a different
 * number — English at 6,000 rather than 1,000.
 *
 * | video | content | channel | platform | views |
 * |-------|---------|---------|----------|-------|
 * | a     | en      | en      | youtube  | 1,000 |
 * | b     | es      | es      | youtube  |   300 |
 * | c     | not set | en      | youtube  | 5,000 |
 * | d     | es      | en      | tiktok   |   700 |
 * | e     | hi      | hi      | youtube  |     — | no views in the window
 */
const VIDEOS = [
  video('a', 'en', 'en', 'youtube'),
  video('b', 'es', 'es', 'youtube'),
  video('c', null, 'en', 'youtube'),
  video('d', 'es', 'en', 'tiktok'),
  video('e', 'hi', 'hi', 'youtube'),
];

const VIEWS: Record<string, number> = { a: 1000, b: 300, c: 5000, d: 700 };

function video(
  videoId: string,
  language: string | null,
  channelLanguage: string | null,
  platform: string,
) {
  return {
    videoId,
    episodeId: `episode-${videoId}`,
    platform,
    contentType: 'full',
    title: `Video ${videoId}`,
    language,
    channelLanguage,
  };
}

const state: {
  hasAccess: boolean;
  calls: Array<{ name: string; input: unknown }>;
  /** Replaces VIDEOS for one test. */
  videos?: unknown[];
} = { hasAccess: true, calls: [] };

function builder(row: unknown, rows: unknown[] = []) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    // One page, then empty: the paged readers stop on a short page.
    range: async (from: number) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
    maybeSingle: async () => ({ data: row, error: null }),
  };

  return chain;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) =>
      table === 'projects'
        ? builder({ account_id: 'account-1' })
        : builder(null, [{ id: 'episode-a', title: 'Episode A' }]),
    rpc: async () => ({ data: state.hasAccess, error: null }),
  }),
}));

vi.mock('@kit/clickhouse/server', async () => {
  const pure =
    await vi.importActual<typeof import('@kit/clickhouse')>('@kit/clickhouse');

  const record = (name: string, input: unknown) =>
    state.calls.push({ name, input });

  return {
    LANGUAGE_DIMENSION_SEGMENTS: {
      content: 'language',
      channel: 'channel_language',
    },
    fromDimLanguage: pure.fromDimLanguage,
    queryVideoLanguages: async (input: unknown) => {
      record('queryVideoLanguages', input);
      return state.videos ?? VIDEOS;
    },
    queryTotalsByVideoIds: async (ids: string[]) => {
      record('queryTotalsByVideoIds', ids);

      return new Map(
        ids
          .filter((id) => VIEWS[id] !== undefined)
          .map((id) => [
            id,
            {
              views: VIEWS[id],
              likes: 0,
              comments: 0,
              shares: 0,
              revenue_cents: 0,
              subscribers_gained: 0,
            },
          ]),
      );
    },
    querySegmentPerformance: async (input: { segment: { kind: string } }) => {
      record('querySegmentPerformance', input);

      // The not-set segment arrives as ClickHouse stores it: ''.
      return input.segment.kind === 'language'
        ? [segment('', 5000, 1), segment('en', 1000, 20), segment('es', 500, 2)]
        : [segment('en', 1000, 24), segment('es', 300, 1)];
    },
    queryDailyStats: async (input: unknown) => {
      record('queryDailyStats', input);

      return Object.entries(VIEWS).map(([id, views]) => ({
        video_id: id,
        metric_date: '2026-09-01',
        views,
      }));
    },
    queryAudienceRows: async () => [],
    queryLanguagePairs: async (input: unknown) => {
      record('queryLanguagePairs', input);

      return [
        { language: 'en', channelLanguage: 'en', videoCount: 1 },
        { language: 'es', channelLanguage: 'en', videoCount: 1 },
        { language: null, channelLanguage: 'en', videoCount: 1 },
      ];
    },
  };
});

function segment(name: string, medianViews: number, mature: number) {
  return {
    segment: name,
    medianViews,
    matureVideoCount: mature,
    videoCount: mature,
    confidence: resolveConfidence(mature),
  };
}

const viewsBy = (rows: Array<{ language: string | null; views: number }>) =>
  new Map(rows.map((row) => [row.language, row.views]));

beforeEach(() => {
  state.hasAccess = true;
  state.calls = [];
  state.videos = undefined;
});

describe('getLanguagePerformance', () => {
  it('keeps a language nobody set out of the English bucket', async () => {
    const views = viewsBy(await getLanguagePerformance('project-1'));

    // Coalescing the unset publish to 'en' makes this 6,000 and removes the
    // null row — the defect the spec exists for.
    expect(views.get('en')).toBe(1000);
    expect(views.get(null)).toBe(5000);
    expect(views.get('es')).toBe(1000);
  });

  it('groups by the channel target when asked, which changes the numbers', async () => {
    const views = viewsBy(
      await getLanguagePerformance('project-1', { dimension: 'channel' }),
    );

    expect(views.get('en')).toBe(6700);
    expect(views.get('es')).toBe(300);
    expect(views.has(null)).toBe(false);
  });

  it('takes its medians from the segment query the Deep Dive runs, per dimension', async () => {
    await getLanguagePerformance('project-1');
    await getLanguagePerformance('project-1', { dimension: 'channel' });

    const kinds = state.calls
      .filter((call) => call.name === 'querySegmentPerformance')
      .map(
        (call) => (call.input as { segment: { kind: string } }).segment.kind,
      );

    expect(kinds).toEqual(['language', 'channel_language']);
  });

  it('carries each language its checkpoint, and reads the not-set segment as null', async () => {
    const rows = await getLanguagePerformance('project-1');
    const notSet = rows.find((row) => row.language === null);
    const english = rows.find((row) => row.language === 'en');

    expect(notSet?.checkpoint).toMatchObject({
      medianViews: 5000,
      matureVideoCount: 1,
      confidence: 'insufficient',
    });
    expect(english?.checkpoint).toMatchObject({
      medianViews: 1000,
      confidence: 'reportable',
      days: 30,
    });
  });

  it('lists a language with no views in the window rather than dropping it', async () => {
    const rows = await getLanguagePerformance('project-1');
    const hindi = rows.find((row) => row.language === 'hi');

    expect(hindi).toMatchObject({
      views: 0,
      videoCount: 1,
      contentCount: 0,
      // No Hindi video has reached the checkpoint: absent, not zero.
      checkpoint: null,
    });
  });

  it('falls back to the content dimension for a value it does not know', async () => {
    const views = viewsBy(
      await getLanguagePerformance('project-1', {
        dimension: 'constructor' as never,
      }),
    );

    expect(views.get(null)).toBe(5000);
  });
});

describe('access', () => {
  it('reads nothing from ClickHouse for a project the caller cannot access', async () => {
    // The Postgres walk these reads replaced ran under the caller's RLS.
    // ClickHouse has none, so without this check any signed-in user could
    // read any project's language breakdown by id.
    state.hasAccess = false;

    expect(await getLanguagePerformance('project-1')).toEqual([]);
    expect(await getPlatformLanguageMatrix('project-1')).toEqual([]);
    expect(await getLanguageTrend('project-1')).toEqual([]);
    expect(await getShortsSourcePerformance('project-1')).toEqual([]);
    expect(await getLanguageDivergence('project-1')).toBeNull();
    expect(state.calls).toEqual([]);
  });
});

describe('getPlatformLanguageMatrix', () => {
  it('gives the unlabelled videos their own column per platform', async () => {
    const cells = (await getPlatformLanguageMatrix('project-1')).map(
      (entry) => `${entry.platform}:${entry.language}=${entry.views}`,
    );

    expect(cells.sort()).toEqual([
      'tiktok:es=700',
      'youtube:en=1000',
      'youtube:es=300',
      'youtube:null=5000',
    ]);
  });
});

describe('getLanguageTrend', () => {
  it('keys the unlabelled series by the not-set key, never by a code', async () => {
    const [day] = await getLanguageTrend('project-1');

    expect(day?.viewsByLanguage).toEqual({
      en: 1000,
      es: 1000,
      [LANGUAGE_NOT_SET_KEY]: 5000,
    });
  });
});

describe('getShortsSourcePerformance', () => {
  it('scopes the dim read to shorts', async () => {
    await getShortsSourcePerformance('project-1');

    expect(state.calls[0]).toEqual({
      name: 'queryVideoLanguages',
      input: { scope: { projectId: 'project-1', contentType: 'short' } },
    });
  });
});

describe('getLanguageDivergence', () => {
  it('counts the videos whose language differs from their channel target', async () => {
    expect(await getLanguageDivergence('project-1')).toMatchObject({
      totalVideos: 3,
      comparableVideos: 2,
      divergentVideos: 1,
      contentNotSetVideos: 1,
    });
  });
});

describe('getContentTypeComparison (FILM-1716)', () => {
  const placed = (
    videoId: string,
    platform: string,
    contentType: string,
    assetDurationSeconds: number | null,
  ) => ({
    ...video(videoId, 'en', 'en', platform),
    contentType,
    assetDurationSeconds,
  });

  it('groups by format family, keeps trailers, and counts what it cannot place', async () => {
    state.videos = [
      placed('a', 'youtube', 'short', 45),
      placed('b', 'youtube', 'trailer', null),
      placed('c', 'twitter', 'short', null),
      placed('d', 'youtube', 'podcast', null),
    ];

    const result = await getContentTypeComparison('project-1');

    expect(
      result.families.map(({ family, views, contentCount }) => ({
        family,
        views,
        contentCount,
      })),
    ).toEqual([
      // A YouTube Short and an X clip are not one product, and a trailer
      // is not long-form.
      { family: 'short_vertical', views: 1000, contentCount: 1 },
      { family: 'trailer', views: 300, contentCount: 1 },
      { family: 'clip', views: 5000, contentCount: 1 },
    ]);
    expect(result.unclassified).toBe(1);
    expect(result.durationUnknown).toBe(2);
  });
});
