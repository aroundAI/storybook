import { describe, expect, it } from 'vitest';

import { MIN_MATURE_VIDEOS } from '../src/lib/cohort-growth';
import { CAPABILITY_MATRIX, capabilityFor } from '../src/lib/data-provenance';
import {
  CONFIDENCE_DIRECTIONAL_MIN,
  resolveConfidence,
} from '../src/lib/segment-stats';
import {
  BENCHMARK_RELAXATION,
  BENCHMARK_WINDOW_MONTHS,
  VIEWS_DATA_WINDOWS,
  bandFor,
  benchmarkCheckpointsFor,
  benchmarkRange,
  benchmarkStepSeries,
  benchmarkVideoAgainstCohort,
  checkpointCapability,
  chooseRelaxation,
  judgeSubjectCheckpoint,
  platformIdOfDim,
  rankingLift,
  shrinkLift,
  viewsDenominatorReason,
} from '../src/lib/self-benchmark';
import type {
  BenchmarkCohortScope,
  CheckpointBenchmark,
  CohortQuantiles,
  RelaxableAxis,
} from '../src/lib/self-benchmark';
import { viewsDenominatorFor } from '../src/lib/view-definitions';

const COHORT: CohortQuantiles = { p25: 100, median: 200, p75: 400, n: 20 };

function judged(value: number) {
  return { judgable: true as const, value };
}

describe('benchmarkVideoAgainstCohort', () => {
  it('returns band, lift, cohort median and n together', () => {
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(500),
      cohort: COHORT,
    });

    expect(result).toMatchObject({
      state: 'established',
      band: 'above',
      observedLift: 2.5,
      cohortMedian: 200,
      n: 20,
    });
  });

  it('keeps both the observed and the adjusted lift', () => {
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(500),
      cohort: COHORT,
    });

    if (result.state !== 'established') throw new Error(result.state);

    expect(result.observedLift).toBe(2.5);
    expect(result.adjustedLift).toBeCloseTo(1 + 1.5 * (20 / 35), 10);
    expect(result.adjustedLift).toBeLessThan(result.observedLift);
  });

  it('calls a cohort of four insufficient, not below', () => {
    // Far under every quartile: a naive band would say "below".
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(1),
      cohort: { ...COHORT, n: 4 },
    });

    expect(result.state).toBe('insufficient_cohort');
    expect(result).not.toHaveProperty('band');
    expect(result).not.toHaveProperty('observedLift');
    expect(result).toMatchObject({
      reason: 'too_few_peers',
      n: 4,
      minPeers: MIN_MATURE_VIDEOS,
      value: 1,
    });
  });

  it('carries a not-judgable reason and no band, value or lift', () => {
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: {
        judgable: false,
        reason: { kind: 'too_young', ageDays: 29, judgableOn: '2026-02-01' },
      },
      cohort: COHORT,
    });

    expect(result).toEqual({
      state: 'not_judgable',
      checkpointDays: 30,
      reason: { kind: 'too_young', ageDays: 29, judgableOn: '2026-02-01' },
    });
  });

  it('refuses a ratio against a zero median as a peer-set fact', () => {
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(50),
      cohort: { p25: 0, median: 0, p75: 0, n: 30 },
    });

    expect(result).toMatchObject({
      state: 'insufficient_cohort',
      reason: 'zero_baseline',
    });
  });

  it('takes its tiers from resolveConfidence (FILM-1606)', () => {
    for (const n of [5, 14, 15, 100]) {
      const result = benchmarkVideoAgainstCohort({
        checkpointDays: 30,
        subject: judged(200),
        cohort: { ...COHORT, n },
      });
      const tier = resolveConfidence(n);

      expect(result.state).toBe(
        tier === 'reportable' ? 'established' : 'directional',
      );
      if (result.state === 'directional' || result.state === 'established') {
        expect(result.confidence).toBe(tier);
      }
    }
  });

  it('gates on the same number as the lowest rendering tier, imported', () => {
    expect(MIN_MATURE_VIDEOS).toBe(CONFIDENCE_DIRECTIONAL_MIN);
  });

  it('reports the relaxed axes it was given', () => {
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(200),
      cohort: COHORT,
      relaxedAxes: ['window', 'language'],
    });

    expect(result).toMatchObject({ relaxedAxes: ['window', 'language'] });
  });
});

/**
 * Exhaustive over the state, so a fifth state added without a rendering
 * decision fails to compile here — the same obligation FILM-1719's renderer
 * has. Only the judged arms can reach `band`.
 */
function describeForScreen(benchmark: CheckpointBenchmark): string {
  switch (benchmark.state) {
    case 'not_judgable':
      return `cannot judge: ${benchmark.reason.kind}`;
    case 'insufficient_cohort':
      return `only ${benchmark.n} comparable videos`;
    case 'directional':
      return `early signal, ${benchmark.band}`;
    case 'established':
      return benchmark.band;
  }
}

describe('the four states are distinguishable', () => {
  it('describes each differently, and only judged ones with a band', () => {
    const states = [
      benchmarkVideoAgainstCohort({
        checkpointDays: 30,
        subject: { judgable: false, reason: { kind: 'nothing_ingested' } },
        cohort: COHORT,
      }),
      benchmarkVideoAgainstCohort({
        checkpointDays: 30,
        subject: judged(1),
        cohort: { ...COHORT, n: 2 },
      }),
      benchmarkVideoAgainstCohort({
        checkpointDays: 30,
        subject: judged(1),
        cohort: { ...COHORT, n: 6 },
      }),
      benchmarkVideoAgainstCohort({
        checkpointDays: 30,
        subject: judged(1),
        cohort: COHORT,
      }),
    ];

    expect(states.map((s) => s.state)).toEqual([
      'not_judgable',
      'insufficient_cohort',
      'directional',
      'established',
    ]);
    expect(new Set(states.map(describeForScreen)).size).toBe(4);
    // A thin peer set and an unjudgable video never say "below".
    expect(describeForScreen(states[0]!)).not.toContain('below');
    expect(describeForScreen(states[1]!)).not.toContain('below');
    expect(describeForScreen(states[3]!)).toBe('below');
  });
});

describe('bandFor', () => {
  it('is below p25, above p75, typical on and between them', () => {
    expect(bandFor(99, COHORT)).toBe('below');
    expect(bandFor(100, COHORT)).toBe('typical');
    expect(bandFor(400, COHORT)).toBe('typical');
    expect(bandFor(401, COHORT)).toBe('above');
  });
});

describe('shrinkage', () => {
  // Two videos at +180% against a hundred at +35%.
  const small = { observed: 2.8, n: 2 };
  const large = { observed: 1.35, n: 100 };

  it('naive lift ranks the two-video cohort first (the failing control)', () => {
    expect(small.observed).toBeGreaterThan(large.observed);
  });

  it('adjusted lift ranks the hundred-video cohort first', () => {
    expect(shrinkLift(small.observed, small.n)).toBeLessThan(
      shrinkLift(large.observed, large.n),
    );
  });

  it('a two-video comparison is never ranked among judged ones', () => {
    const fromTwo = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(560),
      cohort: { p25: 150, median: 200, p75: 250, n: 2 },
    });
    const fromHundred = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(270),
      cohort: { p25: 150, median: 200, p75: 250, n: 100 },
    });

    expect(rankingLift(fromTwo)).toBeNull();
    expect(rankingLift(fromHundred)).toBeCloseTo(1 + 0.35 * (100 / 115), 10);
  });

  it('leaves a lift of 1x where it is and moves toward 1x from below', () => {
    expect(shrinkLift(1, 3)).toBe(1);
    expect(shrinkLift(0.5, 5)).toBeGreaterThan(0.5);
    expect(shrinkLift(0.5, 5)).toBeLessThan(1);
    expect(shrinkLift(3, 0)).toBe(1);
  });
});

describe('per-platform checkpoints', () => {
  it('lets X on its 30-day path be judged at 30 days only', () => {
    expect(
      benchmarkCheckpointsFor('twitter').map((c) => [c.days, c.judgable]),
    ).toEqual([
      [30, true],
      [90, false],
      [180, false],
      [365, false],
    ]);
  });

  it('lets YouTube be judged at every checkpoint', () => {
    expect(benchmarkCheckpointsFor('youtube').every((c) => c.judgable)).toBe(
      true,
    );
  });

  it('is not one global answer', () => {
    const answers = new Set(
      (['youtube', 'twitter'] as const).map((p) =>
        JSON.stringify(benchmarkCheckpointsFor(p).map((c) => c.judgable)),
      ),
    );

    expect(answers.size).toBe(2);
  });

  it('separates "never served" from "stopped moving"', () => {
    expect(
      checkpointCapability({ maxAgeDays: 30, anchoredOn: 'publish_date' }, 90),
    ).toMatchObject({ judgable: false, reason: 'outside_platform_window' });
    expect(
      checkpointCapability(
        {
          maxAgeDays: null,
          anchoredOn: 'publish_date',
          stopsUpdatingAfterDays: 365,
        },
        730,
      ),
    ).toMatchObject({ judgable: false, reason: 'platform_stops_updating' });
    expect(
      checkpointCapability(
        {
          maxAgeDays: null,
          anchoredOn: 'publish_date',
          stopsUpdatingAfterDays: 365,
        },
        365,
      ).judgable,
    ).toBe(true);
  });

  it('never cuts a checkpoint for a job-creation window, which onboarding recovers', () => {
    // The same 30 days, two anchors: one is a property of every post, the
    // other of when the channel was connected.
    expect(
      checkpointCapability({ maxAgeDays: 30, anchoredOn: 'job_creation' }, 90)
        .judgable,
    ).toBe(true);
    expect(
      checkpointCapability({ maxAgeDays: 30, anchoredOn: 'publish_date' }, 90)
        .judgable,
    ).toBe(false);
  });

  it('reads the stored twitter platform as the registry’s twitter', () => {
    expect(platformIdOfDim('twitter')).toBe('twitter');
    expect(platformIdOfDim('youtube')).toBe('youtube');
    expect(platformIdOfDim('myspace')).toBeNull();
    expect(platformIdOfDim('toString')).toBeNull();
  });

  it('reads the ingested platforms from the capability matrix', () => {
    expect(VIEWS_DATA_WINDOWS.instagram).toMatchObject({
      maxAgeDays: 730,
      anchoredOn: 'publish_date',
    });
  });

  it('takes every platform’s window from the capability matrix, never a restated copy', () => {
    // `toBe`, not `toEqual`: a literal copy of today's values is still a
    // second statement of the window, and drifts from the matrix the day
    // either is corrected (KB-163).
    const platforms = Object.keys(
      VIEWS_DATA_WINDOWS,
    ) as (keyof typeof VIEWS_DATA_WINDOWS)[];

    expect(platforms.sort()).toEqual(
      Object.keys(CAPABILITY_MATRIX.engagement).sort(),
    );
    for (const platform of platforms) {
      expect(VIEWS_DATA_WINDOWS[platform], platform).toBe(
        capabilityFor('engagement', platform).window,
      );
    }
  });
});

describe('judgeSubjectCheckpoint', () => {
  const base = {
    platform: 'youtube' as const,
    publishedAt: '2026-01-01 00:00:00',
    checkpointDays: 30,
    channelIngestStart: '2026-01-01',
  };

  it('is not judgable one day short of the checkpoint', () => {
    expect(
      judgeSubjectCheckpoint({
        ...base,
        asOf: new Date('2026-01-30T12:00:00Z'),
      }),
    ).toEqual({
      judgable: false,
      reason: { kind: 'too_young', ageDays: 29, judgableOn: '2026-01-31' },
    });
  });

  it('is judgable on the checkpoint day', () => {
    expect(
      judgeSubjectCheckpoint({
        ...base,
        asOf: new Date('2026-01-31T00:00:00Z'),
      }),
    ).toEqual({ judgable: true });
  });

  it('suppresses a checkpoint whose window predates ingest, naming the window', () => {
    expect(
      judgeSubjectCheckpoint({
        ...base,
        channelIngestStart: '2026-02-15',
        asOf: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toEqual({
      judgable: false,
      reason: {
        kind: 'predates_ingest',
        ingestLagDays: 45,
        window: VIEWS_DATA_WINDOWS.youtube,
      },
    });
  });

  it('says nothing was ingested rather than judging a zero', () => {
    expect(
      judgeSubjectCheckpoint({
        ...base,
        channelIngestStart: null,
        asOf: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toEqual({ judgable: false, reason: { kind: 'nothing_ingested' } });
  });

  it('names the platform window before the video is even asked about', () => {
    expect(
      judgeSubjectCheckpoint({
        ...base,
        platform: 'twitter',
        checkpointDays: 90,
        asOf: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toEqual({
      judgable: false,
      reason: {
        kind: 'outside_platform_window',
        window: VIEWS_DATA_WINDOWS.twitter,
      },
    });
  });
});

describe('relaxation', () => {
  it('widens the window, then drops language, then stops', () => {
    expect(BENCHMARK_RELAXATION.map((s) => s.relaxedAxes)).toEqual([
      [],
      ['window'],
      ['window', 'language'],
    ]);
    expect(BENCHMARK_RELAXATION[0]!.windowMonths).toBe(BENCHMARK_WINDOW_MONTHS);
  });

  it('never relaxes channel or format', () => {
    const relaxable: readonly RelaxableAxis[] = BENCHMARK_RELAXATION.flatMap(
      (s) => s.relaxedAxes,
    );

    for (const axis of relaxable) {
      expect(['window', 'language']).toContain(axis);
    }

    // @ts-expect-error the channel is not a relaxable axis
    const channel: RelaxableAxis = 'channel';
    // @ts-expect-error nor is the format family
    const format: RelaxableAxis = 'format';
    // @ts-expect-error a peer set without a channel does not compile
    const noChannel: BenchmarkCohortScope = {
      accountId: 'a',
      formatFamily: 'short_vertical',
    };
    // @ts-expect-error nor one without a format family
    const noFamily: BenchmarkCohortScope = {
      accountId: 'a',
      connectionId: 'c',
    };

    expect([channel, format, noChannel, noFamily]).toHaveLength(4);
  });

  it('takes the first step that clears the gate', () => {
    const chosen = chooseRelaxation([
      {
        step: BENCHMARK_RELAXATION[0]!,
        column: 'views',
        cohort: { ...COHORT, n: 3 },
      },
      {
        step: BENCHMARK_RELAXATION[1]!,
        column: 'views',
        cohort: { ...COHORT, n: 7 },
      },
      {
        step: BENCHMARK_RELAXATION[2]!,
        column: 'views',
        cohort: { ...COHORT, n: 40 },
      },
    ]);

    expect(chosen?.step.relaxedAxes).toEqual(['window']);
    expect(chosen?.cohort.n).toBe(7);
  });

  it('reports the widest usable step when none clears it', () => {
    const chosen = chooseRelaxation([
      {
        step: BENCHMARK_RELAXATION[0]!,
        column: 'views',
        cohort: { ...COHORT, n: 1 },
      },
      {
        step: BENCHMARK_RELAXATION[1]!,
        column: 'views',
        cohort: { ...COHORT, n: 2 },
      },
      { step: BENCHMARK_RELAXATION[2]!, column: 'views', cohort: null },
    ]);

    expect(chosen?.step.relaxedAxes).toEqual(['window']);
    expect(chosen?.cohort.n).toBe(2);
  });
});

describe('view-definition changes (FILM-1722)', () => {
  it('spans the earliest peer to the end of the video’s own window', () => {
    expect(benchmarkRange('2026-09-01 15:00:00', 24, 30)).toEqual({
      from: '2024-09-01',
      to: '2026-09-30',
      publishedFrom: '2024-09-01 15:00:00',
    });
  });

  it('suppresses a range the continuous series does not cover, with the date', () => {
    const range = benchmarkRange('2026-09-01 00:00:00', 24, 30);
    const denominator = viewsDenominatorFor('youtube', range.from, range.to, {
      format: 'other',
    });

    expect(viewsDenominatorReason(denominator)).toEqual({
      kind: 'view_definition_changed',
      changedOn: '2026-08-27',
    });
  });

  it('computes on engaged views where they cover the range', () => {
    const range = benchmarkRange('2026-09-01 00:00:00', 12, 30);
    const denominator = viewsDenominatorFor('youtube', range.from, range.to, {
      format: 'other',
    });

    expect(denominator).toMatchObject({
      kind: 'column',
      column: 'engaged_views',
    });
    expect(viewsDenominatorReason(denominator)).toBeNull();
  });
});

// Owner decision 2026-10-01: where a range crosses a view-definition change
// and the continuous series begins inside the default window, the window
// starts where that series does — and says so, never silently.
describe('the peer window narrows to the continuous series (owner, 2026-10-01)', () => {
  const longForm = (publishedAt: string) =>
    benchmarkStepSeries({
      platform: 'youtube',
      family: 'long_horizontal',
      publishedAt,
      step: BENCHMARK_RELAXATION[0]!,
      checkpointDays: 30,
    });

  it('benchmarks YouTube long-form across 2026-08-27 on 15 months of engaged views', () => {
    const series = longForm('2026-08-01 00:00:00');

    expect(series.denominator).toMatchObject({
      kind: 'column',
      column: 'engaged_views',
    });
    expect(series.range.publishedFrom).toBe('2025-04-24 00:00:00');
    expect(series.window).toEqual({
      months: 15,
      defaultMonths: 24,
      narrowed: {
        reason: 'view_definition_changed',
        changedOn: '2026-08-27',
        continuousFrom: '2025-04-24',
      },
    });
  });

  it('narrows across the whole affected range, and not after it', () => {
    expect(longForm('2026-07-29 00:00:00').window.months).toBe(15);
    expect(longForm('2027-04-23 00:00:00').window.months).toBe(23);
    expect(longForm('2027-04-24 00:00:00').window).toEqual({
      months: 24,
      defaultMonths: 24,
      narrowed: null,
    });
  });

  it('leaves a range with one definition at its default length', () => {
    expect(longForm('2026-03-01 00:00:00').window.narrowed).toBeNull();
  });

  it('still suppresses where no continuous series exists', () => {
    const series = benchmarkStepSeries({
      platform: 'instagram',
      family: 'short_vertical',
      publishedAt: '2026-03-01 00:00:00',
      step: BENCHMARK_RELAXATION[0]!,
      checkpointDays: 30,
    });

    expect(viewsDenominatorReason(series.denominator)).toEqual({
      kind: 'view_definition_changed',
      changedOn: '2025-04-21',
    });
    expect(series.window.narrowed).toBeNull();
  });

  it('carries the window into the comparison, so it says "15 months, not 24"', () => {
    const { window } = longForm('2026-08-01 00:00:00');
    const result = benchmarkVideoAgainstCohort({
      checkpointDays: 30,
      subject: judged(500),
      cohort: COHORT,
      peerWindow: window,
    });

    expect(result).toMatchObject({
      state: 'established',
      peerWindow: { months: 15, defaultMonths: 24 },
    });
  });
});
