import { describe, expect, it } from 'vitest';

import { CAPABILITY_MATRIX } from '@kit/clickhouse';

import { backCatalogClaim } from '../src/components/deep-dive/back-catalog-card';
import {
  medianViewsClaim,
  medianViewsDetails,
} from '../src/components/deep-dive/median-views-card';
import {
  TRAFFIC_BREAKDOWN_DETAILS,
  trafficBreakdownClaim,
  trafficShareClaim,
  trafficShareDetails,
} from '../src/components/deep-dive/traffic-share-card';
import {
  CAUSAL_VOCABULARY,
  type CardClaim,
  claimFromQuery,
  countClaim,
  genderClaim,
  platformSplitClaim,
  sourceNotesFor,
  topContentClaim,
  topRegionClaim,
} from '../src/components/overview/card-claim';

/**
 * FILM-1706. Every card leads with one figure and one sentence. The figure
 * is a value the card already measured — never a new score — and the
 * sentence says what was measured, never why: a cause needs an experiment
 * (FILM-1724), and a card cannot run one.
 */
const group = (name: string, views: number, total: number) => ({
  group: name,
  views,
  watchTimeMinutes: 0,
  share: total > 0 ? views / total : 0,
});

const trafficBucket = (bucket: string, browse: number, search: number) => {
  const total = browse + search;

  return {
    bucket,
    totalViews: total,
    totalWatchTimeMinutes: 0,
    groups: [
      group('browse_suggested', browse, total),
      group('search', search, total),
    ],
  } as never;
};

/** Every branch of every builder, so the vocabulary check sees them all. */
const CLAIMS: Array<[string, CardClaim | 'loading']> = [
  ['count', countClaim(111_111, 'Views of this project’s published videos.')],
  ['count absent', countClaim(null, 'Views.')],
  [
    'split',
    platformSplitClaim([
      { platform: 'youtube', views: 3 },
      { platform: 'tiktok', views: 1 },
    ]),
  ],
  [
    'split tie',
    platformSplitClaim([
      { platform: 'youtube', views: 2 },
      { platform: 'tiktok', views: 2 },
    ]),
  ],
  ['split none', platformSplitClaim([])],
  ['gender', genderClaim({ male: 40, female: 60 })],
  ['gender tie', genderClaim({ male: 50, female: 50 })],
  ['region', topRegionClaim([{ country: 'IN', percentage: 42 }])],
  ['region none', topRegionClaim([])],
  ['top', topContentClaim([{ title: 'Pilot', views: 900 }])],
  [
    'top tie',
    topContentClaim([
      { title: 'A', views: 5 },
      { title: 'B', views: 5 },
    ]),
  ],
  ['top none', topContentClaim([])],
  [
    'median',
    medianViewsClaim(
      [
        {
          bucket: '2026-08-01',
          medianViews: 20,
          meanViews: 40,
          p25Views: 10,
          p75Views: 90,
          videoCount: 3,
        },
      ] as never,
      'cohort_views_to_date',
    ),
  ],
  ['median none', medianViewsClaim([], 'views_in_period')],
  [
    'back catalog',
    backCatalogClaim([
      { bucket: '2026-07-01', share: 0.1, totalViews: 10 },
      { bucket: '2026-08-01', share: 0.2, totalViews: 10 },
      { bucket: '2026-09-01', share: 0.3, totalViews: 10 },
    ] as never),
  ],
  ['back catalog none', backCatalogClaim([])],
  [
    'traffic share above',
    trafficShareClaim(
      [
        {
          bucket: '2026-09-13',
          totalViews: 10,
          browseSuggestedViews: 7,
          share: 0.7,
        },
      ],
      { bucketNoun: 'week', windowLabel: 'the window' },
    ),
  ],
  [
    'traffic share below',
    trafficShareClaim(
      [
        {
          bucket: '2026-09-13',
          totalViews: 10,
          browseSuggestedViews: 3,
          share: 0.3,
        },
      ],
      { bucketNoun: 'week', windowLabel: 'the window' },
    ),
  ],
  [
    'traffic share none',
    trafficShareClaim(
      [
        {
          bucket: '2026-09-13',
          totalViews: 0,
          browseSuggestedViews: 0,
          share: 0,
        },
      ],
      { bucketNoun: 'week', windowLabel: 'the window' },
    ),
  ],
  [
    'traffic breakdown',
    trafficBreakdownClaim([trafficBucket('2026-09-13', 3, 1)], 'the window'),
  ],
  [
    'traffic breakdown none',
    trafficBreakdownClaim([trafficBucket('2026-09-13', 0, 0)], 'the window'),
  ],
  [
    'query loading',
    claimFromQuery({ isLoading: true, isError: false, data: undefined }, () =>
      countClaim(1, 'x.'),
    ),
  ],
  [
    'query failed',
    claimFromQuery(
      { isLoading: false, isError: true, data: undefined },
      () => countClaim(1, 'x.'),
      'Median views could not be loaded.',
    ),
  ],
];

describe('card claims', () => {
  it.each(CLAIMS)('%s: states what was measured, never why', (_, claim) => {
    if (claim === 'loading') return;

    expect(claim.sentence).not.toMatch(CAUSAL_VOCABULARY);
    expect(claim.sentence.trim().length).toBeGreaterThan(0);
  });

  it.each(CLAIMS)('%s: a missing figure always says why', (_, claim) => {
    if (claim === 'loading' || claim.figure !== null) return;

    expect(claim.noFigure.trim().length).toBeGreaterThan(0);
  });

  it('the vocabulary check is not vacuous', () => {
    expect('Views rose because of the thumbnail.').toMatch(CAUSAL_VOCABULARY);
    expect('YouTube drives 62% of views.').toMatch(CAUSAL_VOCABULARY);
  });

  it('a count that could not be read shows no number, not zero', () => {
    expect(countClaim(null, 'Views.')).toMatchObject({ figure: null });
  });

  it('a query that is still loading claims nothing yet', () => {
    expect(CLAIMS.find(([name]) => name === 'query loading')?.[1]).toBe(
      'loading',
    );
  });

  it('a failed query says so rather than drawing a zero', () => {
    expect(CLAIMS.find(([name]) => name === 'query failed')?.[1]).toMatchObject(
      { figure: null, sentence: 'Median views could not be loaded.' },
    );
  });

  it('computes the figures a reader can check by hand', () => {
    const figure = (name: string) => {
      const claim = CLAIMS.find(([entry]) => entry === name)?.[1];

      return claim === 'loading' ? undefined : claim?.figure;
    };

    expect(figure('count')).toBe('111,111');
    expect(figure('split')).toBe('75%'); // 3 of 4 views
    expect(figure('gender')).toBe('60%');
    expect(figure('region')).toBe('42%');
    expect(figure('median')).toBe('20'); // median of 10, 20, 90
    expect(figure('back catalog')).toBe('30%');
    expect(figure('traffic share above')).toBe('70%');
    expect(figure('traffic breakdown')).toBe('75%'); // Browse 3 of 4
  });

  it('names a month in words, not as an axis label', () => {
    const claim = CLAIMS.find(([name]) => name === 'median')?.[1];

    expect(claim === 'loading' ? '' : claim?.sentence).toBe(
      'Median views to date for videos uploaded in August 2026.',
    );
  });

  it('names no single winner when two tie', () => {
    const sentence = (name: string) => {
      const claim = CLAIMS.find(([entry]) => entry === name)?.[1];

      return claim === 'loading' ? '' : (claim?.sentence ?? '');
    };

    expect(sentence('split tie')).not.toMatch(/largest share/);
    expect(sentence('gender tie')).not.toMatch(/largest share/);
    expect(sentence('top tie')).not.toMatch(/had the most/);
  });
});

describe('where a figure comes from', () => {
  it('is the matrix’s own sentence for each platform that has the data', () => {
    const notes = sourceNotesFor('traffic_sources');

    expect(notes).toEqual([CAPABILITY_MATRIX.traffic_sources.youtube.note]);
  });

  it('covers every family a card spans', () => {
    const notes = sourceNotesFor(['channel_totals', 'watch_time']);

    expect(notes).toContain(CAPABILITY_MATRIX.channel_totals.youtube.note);
    expect(notes).toContain(CAPABILITY_MATRIX.watch_time.youtube.note);
  });

  it('says in words when the source is not a platform', () => {
    expect(sourceNotesFor('recorded')).toHaveLength(1);
    expect(sourceNotesFor('generated')).toHaveLength(1);
    expect(sourceNotesFor('recorded')[0]).not.toMatch(/[`_]|ClickHouse/);
  });
});

describe('caveats that moved into details', () => {
  // Each was on the front of its card before FILM-1706. "Cleaner" is only
  // an improvement while they are all still there, one click away.
  it.each([
    [
      'traffic breakdown',
      TRAFFIC_BREAKDOWN_DETAILS.caveats,
      'these percentages will not match YouTube Studio exactly',
    ],
    [
      'traffic share: the newest week may be partial',
      trafficShareDetails('week').caveats,
      'report ingest lags a few days so it may be only partly counted',
    ],
    [
      'traffic share: the dashed line',
      trafficShareDetails('week').caveats,
      'The dashed line marks 60%',
    ],
    [
      'median: why a median',
      medianViewsDetails([], 'cohort_views_to_date').caveats,
      'The median resists outliers',
    ],
  ])('%s', (_, caveats, text) => {
    expect(caveats.some((caveat) => String(caveat).includes(text))).toBe(true);
  });

  it('the outlier note appears when the mean runs away from the median', () => {
    const { caveats } = medianViewsDetails(
      [
        {
          bucket: '2026-08-01',
          medianViews: 20,
          meanViews: 400,
          p25Views: 10,
          p75Views: 90,
          videoCount: 3,
        },
      ],
      'cohort_views_to_date',
    );

    expect(caveats.join(' ')).toContain('an outlier is pulling the average up');
  });
});
