import { describe, expect, it } from 'vitest';

import type { ViewsDenominator } from '@kit/clickhouse';

import {
  type ExperimentMeasureContext,
  type ExperimentVideoSource,
  measureExperimentVideo,
} from '../src/lib/channel-experiment-measures';

const VIEWS: ViewsDenominator = {
  kind: 'column',
  column: 'views',
  definitions: [],
};

const asOf = new Date('2026-06-01T12:00:00Z');

function context(
  overrides: Partial<ExperimentMeasureContext> = {},
): ExperimentMeasureContext {
  return {
    formatFamily: 'long_horizontal',
    measures: [
      'views',
      'ctr',
      'avg_view_percentage',
      'subscribers_per_1000_views',
    ],
    asOf,
    channelIngestStart: '2026-01-01',
    views: VIEWS,
    ...overrides,
  };
}

const day = (
  ageDays: number,
  views: number,
  extra: Partial<NonNullable<ExperimentVideoSource['facts']>['days'][0]> = {},
) => ({
  ageDays,
  views,
  engagedViews: null,
  avgViewPercentage: 40,
  subscribersGained: 0,
  subscribersLost: 0,
  ...extra,
});

function video(
  publishedAt: string,
  facts: Partial<NonNullable<ExperimentVideoSource['facts']>> = {},
  overrides: Partial<ExperimentVideoSource> = {},
): ExperimentVideoSource {
  return {
    publishId: 'p1',
    styleId: 's1',
    platform: 'youtube',
    contentType: 'full',
    durationSeconds: null,
    publishedAt,
    facts: { publishedAt, days: [], reach: [], ...facts },
    ...overrides,
  };
}

describe('measureExperimentVideo', () => {
  it('reads a video younger than a checkpoint as pending, with the date it becomes readable', () => {
    const result = measureExperimentVideo(
      video('2026-05-29 00:00:00', { days: [day(0, 500)] }),
      context(),
    );

    expect(result.measurements['views@7']).toEqual({
      state: 'pending',
      judgableOn: '2026-06-05',
    });
    expect(result.measurements['views@30']).toMatchObject({ state: 'pending' });
  });

  it('sums views over the first N calendar days only', () => {
    const result = measureExperimentVideo(
      video('2026-05-01 00:00:00', {
        days: [day(0, 100), day(6, 50), day(7, 999), day(29, 1)],
      }),
      context(),
    );

    expect(result.measurements['views@7']).toEqual({
      state: 'measured',
      value: 150,
    });
    expect(result.measurements['views@30']).toEqual({
      state: 'measured',
      value: 1150,
    });
  });

  it('pools CTR by impressions, with FILM-1610 foldCtr', () => {
    const result = measureExperimentVideo(
      video('2026-05-01 00:00:00', {
        reach: [
          { ageDays: 1, impressions: 1000, impressionsCtr: 0.1 },
          { ageDays: 2, impressions: 9000, impressionsCtr: 0.02 },
          { ageDays: 8, impressions: 100000, impressionsCtr: 0.9 },
        ],
      }),
      context(),
    );

    // 280 clicks in 10,000 impressions; the day-8 row is past the window.
    expect(result.measurements['ctr@7']).toMatchObject({ state: 'measured' });
    expect(
      (result.measurements['ctr@7'] as { value: number }).value,
    ).toBeCloseTo(0.028);
  });

  it('weights average percentage viewed by views, and says when the platform never reports it', () => {
    const measured = measureExperimentVideo(
      video('2026-05-01 00:00:00', {
        days: [
          day(0, 100, { avgViewPercentage: 50 }),
          day(1, 300, { avgViewPercentage: 30 }),
        ],
      }),
      context(),
    );

    expect(measured.measurements['avg_view_percentage@7']).toEqual({
      state: 'measured',
      value: 35,
    });

    const unreported = measureExperimentVideo(
      video('2026-05-01 00:00:00', {
        days: [day(0, 100, { avgViewPercentage: null })],
      }),
      context(),
    );

    expect(unreported.measurements['avg_view_percentage@7']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'not_reported_by_platform' },
    });
  });

  it('gives net subscribers per 1,000 views, and no rate from no views', () => {
    const result = measureExperimentVideo(
      video('2026-04-01 00:00:00', {
        days: [
          day(0, 1500, { subscribersGained: 25, subscribersLost: 5 }),
          day(20, 500, { subscribersGained: 5, subscribersLost: 5 }),
        ],
      }),
      context(),
    );

    // (30 - 10) / 2,000 × 1,000
    expect(result.measurements['subscribers_per_1000_views@30']).toEqual({
      state: 'measured',
      value: 10,
    });

    const silent = measureExperimentVideo(
      video('2026-04-01 00:00:00'),
      context(),
    );

    // No rows on an ingested channel: zero views is a real figure…
    expect(silent.measurements['views@30']).toEqual({
      state: 'measured',
      value: 0,
    });
    // …but a rate per view of nothing is not.
    expect(silent.measurements['subscribers_per_1000_views@30']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'no_data' },
    });
  });

  it('leaves a net unknown when a day did not report losses', () => {
    const result = measureExperimentVideo(
      video('2026-04-01 00:00:00', {
        days: [day(0, 1000, { subscribersGained: 9, subscribersLost: null })],
      }),
      context(),
    );

    expect(result.measurements['subscribers_per_1000_views@30']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'not_reported_by_platform' },
    });
  });

  it('says a checkpoint predates ingest rather than reading it', () => {
    const result = measureExperimentVideo(
      video('2026-05-01 00:00:00', { days: [day(9, 10)] }),
      context({ channelIngestStart: '2026-05-10' }),
    );

    expect(result.measurements['views@7']).toMatchObject({
      state: 'not_measurable',
      reason: { kind: 'predates_ingest' },
    });
  });

  it('reads views from the experiment-wide series, and an unreported day is no data', () => {
    const result = measureExperimentVideo(
      video('2026-05-01 00:00:00', {
        days: [day(0, 100, { engagedViews: 80 }), day(1, 100)],
      }),
      context({
        views: { kind: 'column', column: 'engaged_views', definitions: [] },
      }),
    );

    expect(result.measurements['views@7']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'no_data' },
    });
  });

  it('takes a video out of the comparison when its family has changed since assignment', () => {
    const result = measureExperimentVideo(
      video(
        '2026-05-01 00:00:00',
        { days: [day(0, 100)] },
        { contentType: 'short', durationSeconds: 200 },
      ),
      context({ formatFamily: 'short_vertical', measures: ['views'] }),
    );

    expect(result.measurements['views@7']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'format_changed', family: 'long_vertical' },
    });
  });

  it('reads the hook at 3 seconds only where the curve resolves it', () => {
    const curve = [
      { elapsedRatio: 0, audienceWatchRatio: 1 },
      { elapsedRatio: 0.1, audienceWatchRatio: 0.6 },
    ];
    const short = (durationSeconds: number | null) =>
      measureExperimentVideo(
        video(
          '2026-05-01 00:00:00',
          {},
          { contentType: 'short', durationSeconds, curve },
        ),
        context({
          formatFamily: 'short_vertical',
          measures: ['hook_retention_3s'],
        }),
      ).measurements['hook_retention_3s@7'];

    // 3s of 30s is 10% through: the curve's 0.6.
    expect(short(30)).toEqual({ state: 'measured', value: 0.6 });
    expect(short(null)).toEqual({
      state: 'not_measurable',
      reason: { kind: 'duration_unknown' },
    });
    expect(short(160)).toEqual({
      state: 'not_measurable',
      reason: { kind: 'too_long_for_hook', seconds: 160 },
    });
  });

  it('says a video is not collected yet rather than giving it zeros', () => {
    const result = measureExperimentVideo(
      { ...video('2026-05-01 00:00:00'), facts: undefined },
      context({ measures: ['views'] }),
    );

    expect(result.measurements['views@7']).toEqual({
      state: 'not_measurable',
      reason: { kind: 'not_ingested' },
    });
  });
});
