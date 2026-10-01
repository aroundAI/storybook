import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_VERDICT_MIN,
  type VideoMeasurement,
  compareStyles,
  experimentFindings,
  quantileInclusive,
  relationBetween,
  summariseStyle,
  toConcludedChannelExperiment,
  verdictFor,
} from '../src/lib/channel-experiments';
import { MIN_MATURE_VIDEOS } from '../src/lib/cohort-growth';

const measured = (value: number): VideoMeasurement => ({
  state: 'measured',
  value,
});
const pending: VideoMeasurement = {
  state: 'pending',
  judgableOn: '2026-10-08',
};

const styleA = { id: 'a', name: 'Mouth open' };
const styleB = { id: 'b', name: 'Mouth closed' };

describe('quantileInclusive', () => {
  it('interpolates between closest ranks, as quantileExactInclusive does', () => {
    const sorted = [1, 2, 3, 4];

    expect(quantileInclusive(sorted, 0.25)).toBe(1.75);
    expect(quantileInclusive(sorted, 0.5)).toBe(2.5);
    expect(quantileInclusive(sorted, 0.75)).toBe(3.25);
    expect(quantileInclusive([7], 0.25)).toBe(7);
  });
});

describe('summariseStyle', () => {
  it('counts a pending video as pending, never as a zero in the median', () => {
    const summary = summariseStyle(styleA, [
      measured(100),
      measured(200),
      measured(300),
      pending,
      pending,
    ]);

    expect(summary.measured).toBe(3);
    expect(summary.pending).toBe(2);
    // With the two pending videos as zeros the median would be 100.
    expect(summary.distribution).toEqual({ p25: 150, median: 200, p75: 250 });
  });

  it('keeps an unmeasurable video out of the figures and counts it apart', () => {
    const summary = summariseStyle(styleA, [
      measured(10),
      { state: 'not_measurable', reason: { kind: 'no_data' } },
    ]);

    expect(summary).toMatchObject({
      measured: 1,
      pending: 0,
      notMeasurable: 1,
    });
    expect(summary.distribution?.median).toBe(10);
  });

  it('has no distribution, not a zero one, when nothing is measured', () => {
    const summary = summariseStyle(styleA, [pending, pending]);

    expect(summary.distribution).toBeNull();
    expect(summary.confidence).toBe('insufficient');
  });

  it('labels a thin style with FILM-1606 tiers rather than ranking it', () => {
    const five = summariseStyle(styleA, [1, 2, 3, 4, 5].map(measured));
    const twenty = summariseStyle(
      styleB,
      Array.from({ length: 20 }, (_, i) => measured(i)),
    );

    expect(five.confidence).toBe('directional');
    expect(twenty.confidence).toBe('reportable');
  });
});

describe('relationBetween', () => {
  it('says ahead only where the ranges do not overlap', () => {
    expect(
      relationBetween(
        { p25: 11, median: 12, p75: 13 },
        { p25: 5, median: 7, p75: 10 },
      ),
    ).toBe('ahead');
    expect(
      relationBetween(
        { p25: 5, median: 7, p75: 10 },
        { p25: 11, median: 12, p75: 13 },
      ),
    ).toBe('behind');
  });

  it('reads overlapping ranges as no clear difference, whatever the medians', () => {
    expect(
      relationBetween(
        { p25: 5, median: 30, p75: 40 },
        { p25: 1, median: 2, p75: 6 },
      ),
    ).toBe('no_clear_difference');
  });

  it('treats touching ranges as overlapping, as bandFor is inclusive', () => {
    expect(
      relationBetween(
        { p25: 10, median: 12, p75: 13 },
        { p25: 5, median: 7, p75: 10 },
      ),
    ).toBe('no_clear_difference');
  });
});

describe('verdictFor', () => {
  it('uses FILM-1715 MIN_MATURE_VIDEOS as its threshold', () => {
    expect(EXPERIMENT_VERDICT_MIN).toBe(MIN_MATURE_VIDEOS);
  });

  it('gives no verdict while any style is under the threshold, and says how many more', () => {
    const verdict = verdictFor([
      summariseStyle(styleA, [100, 110, 120, 130, 140, 150].map(measured)),
      summariseStyle(styleB, [1, 2, 3, 4].map(measured)),
    ]);

    expect(verdict).toEqual({
      kind: 'too_few',
      threshold: 5,
      needs: [{ styleId: 'b', more: 1 }],
    });
  });

  it('compares every pair once each style has enough', () => {
    const verdict = verdictFor([
      summariseStyle(styleA, [100, 110, 120, 130, 140].map(measured)),
      summariseStyle(styleB, [1, 2, 3, 4, 5].map(measured)),
    ]);

    expect(verdict).toMatchObject({
      kind: 'compared',
      anyClearDifference: true,
      pairs: [
        { styleId: 'a', otherStyleId: 'b', relation: 'ahead' },
        { styleId: 'b', otherStyleId: 'a', relation: 'behind' },
      ],
    });
  });

  it('says no clear difference yet when every range overlaps', () => {
    const verdict = verdictFor([
      summariseStyle(styleA, [1, 5, 9, 13, 17].map(measured)),
      summariseStyle(styleB, [3, 6, 9, 12, 15].map(measured)),
    ]);

    expect(verdict).toMatchObject({
      kind: 'compared',
      anyClearDifference: false,
    });
  });
});

describe('compareStyles', () => {
  it('reports each measure at each of its checkpoints, for the chosen measures only', () => {
    const results = compareStyles({
      styles: [styleA, styleB],
      videos: [
        {
          publishId: 'p1',
          styleId: 'a',
          measurements: { 'views@7': measured(100), 'views@30': pending },
        },
      ],
      measures: ['views'],
      asOf: new Date('2026-10-01T00:00:00Z'),
    });

    expect(
      results.results.map((r) => `${r.measure}@${r.checkpointDays}`),
    ).toEqual(['views@7', 'views@30']);
    expect(results.results[1]!.styles[0]).toMatchObject({
      measured: 0,
      pending: 1,
    });
  });
});

describe('ConcludedChannelExperiment', () => {
  const results = compareStyles({
    styles: [styleA, styleB],
    videos: [
      ...[100, 110, 120, 130, 140].map((value, i) => ({
        publishId: `a${i}`,
        styleId: 'a',
        measurements: { 'views@7': measured(value) },
      })),
      ...[1, 2, 3, 4, 5].map((value, i) => ({
        publishId: `b${i}`,
        styleId: 'b',
        measurements: { 'views@7': measured(value) },
      })),
    ],
    measures: ['views'],
    asOf: new Date('2026-10-01T00:00:00Z'),
  });

  const record = {
    id: 'x',
    account_id: 'acc',
    connection_id: 'conn',
    format_family: 'long_horizontal',
    title: 'Mouths',
    hypothesis: null,
    expected_outcome: null,
    status: 'concluded',
    started_at: '2026-08-01',
    ended_at: '2026-10-01',
    conclusion: 'Open mouths ahead at 7 days',
    outcome_status: 'confirmed',
    result_snapshot: results,
    styles: [
      { ...styleA, description: null },
      { ...styleB, description: null },
    ],
  };

  it('is null for an experiment that has not concluded, so its associations are never evidence', () => {
    expect(
      toConcludedChannelExperiment({ ...record, status: 'running' }),
    ).toBeNull();
    expect(
      toConcludedChannelExperiment({ ...record, result_snapshot: {} }),
    ).toBeNull();
  });

  it('yields findings only where ranges did not overlap, named by their basis', () => {
    const concluded = toConcludedChannelExperiment(record)!;
    const findings = experimentFindings(concluded);

    // views@7 compared and separated; views@30 had nothing measured.
    expect(findings).toEqual([
      {
        basis: 'concluded_channel_experiment',
        experimentId: 'x',
        measure: 'views',
        checkpointDays: 7,
        aheadStyleId: 'a',
        behindStyleId: 'b',
        aheadMeasured: 5,
        behindMeasured: 5,
      },
    ]);
  });
});
