import { describe, expect, it } from 'vitest';

import {
  MIN_MATURE_VIDEOS,
  metricProvenanceFor,
  stageReading,
} from '@kit/clickhouse';
import type { GenomeFinding, SegmentMeasure } from '@kit/clickhouse';

import {
  type StageSurface,
  type StageVideoFigure,
  claimSentence,
  diagnosisOf,
  measureLine,
  stagePeers,
  stageSurfaceFor,
} from '../src/lib/signal-surface';

/**
 * FILM-1719. The surface decides which of five states a stage is in and
 * keeps them apart; every figure in them is a spec below's.
 */

const SUBJECT = {
  videoId: 'subject',
  publishedAt: '2026-06-01 12:00:00',
  formatFamily: 'short_vertical' as const,
  checkpoint: { judgable: true } as const,
};

function peers(
  count: number,
  value: (index: number) => number | null,
  overrides: Partial<StageVideoFigure> = {},
): StageVideoFigure[] {
  return Array.from({ length: count }, (_, index) => ({
    videoId: `peer-${index}`,
    publishedAt: `2026-0${1 + (index % 4)}-${String(10 + index).padStart(2, '0')} 00:00:00`,
    formatFamily: 'short_vertical' as const,
    value: value(index),
    ...overrides,
  }));
}

function surfaceAt(
  stage:
    | 'reach'
    | 'hook'
    | 'attention'
    | 'transmission'
    | 'audience'
    | 'monetisation',
  rows: StageVideoFigure[],
  options: {
    platform?: 'youtube' | 'facebook';
    formatFamily?: 'short_vertical' | 'long_horizontal';
    checkpoint?:
      | typeof SUBJECT.checkpoint
      | {
          judgable: false;
          reason: { kind: 'too_young'; ageDays: number; judgableOn: string };
        };
  } = {},
): StageSurface {
  const platform = options.platform ?? 'youtube';
  const formatFamily = options.formatFamily ?? 'short_vertical';

  return stageSurfaceFor({
    reading: stageReading(platform, formatFamily, stage),
    platform,
    subject: {
      ...SUBJECT,
      formatFamily,
      checkpoint: options.checkpoint ?? SUBJECT.checkpoint,
    },
    checkpointDays: 30,
    rows,
    provenanceFor: (signal: SegmentMeasure) =>
      metricProvenanceFor(signal, platform),
  });
}

const subjectRow = (value: number | null): StageVideoFigure => ({
  videoId: 'subject',
  publishedAt: SUBJECT.publishedAt,
  formatFamily: 'short_vertical',
  value,
});

describe('the five states', () => {
  it('unbound: the platform has no such figure, and says why', () => {
    // YouTube reports no impressions for a Short (FILM-1714).
    const surface = surfaceAt('reach', []);

    expect(surface.state).toBe('unbound');
    expect(surface.state === 'unbound' && surface.note.length).toBeGreaterThan(
      0,
    );
  });

  it('dark: inputs not collected, with the blockers', () => {
    const surface = surfaceAt('monetisation', [], { platform: 'facebook' });

    expect(surface).toMatchObject({ state: 'dark', gap: 'not_ingested' });
    expect(surface.state === 'dark' && surface.blockers.length).toBeGreaterThan(
      0,
    );
  });

  it('dark: collected, but no per-video checkpoint reading — our gap, not the platform’s', () => {
    // A Short's hook is first_3s_retention, read off a curve, not a segment measure.
    const surface = surfaceAt('hook', []);

    expect(surface).toMatchObject({
      state: 'dark',
      gap: 'no_checkpoint_measure',
      signal: 'first_3s_retention',
    });
  });

  it('not_judgable: too young, and keeps the measured figure where one exists', () => {
    const surface = surfaceAt('attention', [subjectRow(41)], {
      checkpoint: {
        judgable: false,
        reason: { kind: 'too_young', ageDays: 12, judgableOn: '2026-07-01' },
      },
    });

    expect(surface).toMatchObject({ state: 'not_judgable', value: 41 });
  });

  it('not_judgable: no figure for this video, never a zero', () => {
    const surface = surfaceAt('audience', [
      subjectRow(null),
      ...peers(20, () => 0.01),
    ]);

    expect(surface).toMatchObject({
      state: 'not_judgable',
      value: null,
      why: { kind: 'no_figure' },
    });
  });

  it('insufficient_cohort: too few peers keeps the figure and the count, and no band', () => {
    const surface = surfaceAt('attention', [
      subjectRow(30),
      ...peers(MIN_MATURE_VIDEOS - 1, () => 40),
    ]);

    expect(surface).toMatchObject({
      state: 'insufficient_cohort',
      value: 30,
      reason: 'too_few_peers',
      n: MIN_MATURE_VIDEOS - 1,
    });
    expect(surface).not.toHaveProperty('benchmark');
  });

  it('insufficient_cohort: a zero typical figure is not a comparison', () => {
    const surface = surfaceAt('transmission', [
      subjectRow(0.02),
      ...peers(20, () => 0),
    ]);

    expect(surface).toMatchObject({
      state: 'insufficient_cohort',
      reason: 'zero_baseline',
    });
  });

  it('judged below: band, value, lift, typical and n together', () => {
    const surface = surfaceAt('attention', [
      subjectRow(10),
      ...peers(20, (index) => 30 + index),
    ]);

    expect(surface.state).toBe('judged');
    if (surface.state !== 'judged') return;

    expect(surface.benchmark.band).toBe('below');
    expect(surface.benchmark.n).toBe(20);
    expect(surface.benchmark.cohortMedian).toBe(39.5);
    expect(surface.peers).toHaveLength(20);
    expect(measureLine(surface.signal, surface.benchmark)).toBe(
      `0:10 average view duration · ${surface.benchmark.adjustedLift.toFixed(1)}x typical · typical = 0:40 · n = 20`,
    );
  });
});

describe('peers', () => {
  const subject = {
    videoId: 'subject',
    publishedAt: '2026-06-01 12:00:00',
    formatFamily: 'short_vertical' as const,
  };

  it('are earlier videos of the same format inside the window, with a figure', () => {
    const rows: StageVideoFigure[] = [
      { ...subjectRow(5) },
      {
        videoId: 'later',
        publishedAt: '2026-06-02 00:00:00',
        formatFamily: 'short_vertical',
        value: 1,
      },
      {
        videoId: 'other-format',
        publishedAt: '2026-05-01 00:00:00',
        formatFamily: 'long_horizontal',
        value: 1,
      },
      {
        videoId: 'no-figure',
        publishedAt: '2026-05-01 00:00:00',
        formatFamily: 'short_vertical',
        value: null,
      },
      {
        videoId: 'too-old',
        publishedAt: '2024-05-01 00:00:00',
        formatFamily: 'short_vertical',
        value: 1,
      },
      {
        videoId: 'kept',
        publishedAt: '2025-06-02 00:00:00',
        formatFamily: 'short_vertical',
        value: 1,
      },
    ];

    expect(stagePeers(rows, subject, 24).map((peer) => peer.videoId)).toEqual([
      'kept',
    ]);
    expect(stagePeers(rows, subject, 48).map((peer) => peer.videoId)).toEqual([
      'too-old',
      'kept',
    ]);
  });

  it('widen to 48 months only when 24 is too thin, and say so', () => {
    const near = peers(MIN_MATURE_VIDEOS - 2, () => 30);
    const far = peers(4, () => 30, { publishedAt: '2024-01-01 00:00:00' }).map(
      (row, index) => ({ ...row, videoId: `far-${index}` }),
    );
    const surface = surfaceAt('attention', [subjectRow(30), ...near, ...far]);

    expect(surface.state).toBe('judged');
    expect(surface.state === 'judged' && surface.benchmark.relaxedAxes).toEqual(
      ['window', 'language'],
    );
  });

  it('never hold language, and the comparison says so', () => {
    const surface = surfaceAt('attention', [
      subjectRow(30),
      ...peers(20, () => 30),
    ]);

    expect(surface.state === 'judged' && surface.benchmark.relaxedAxes).toEqual(
      ['language'],
    );
  });
});

describe('the diagnosis', () => {
  it('is FILM-1718’s, read from the same surfaces, with the judged count', () => {
    const judged = (band: 'below' | 'above') =>
      surfaceAt('attention', [
        subjectRow(band === 'below' ? 1 : 100),
        ...peers(20, (index) => 30 + index),
      ]);
    const unbound = surfaceAt('reach', []);
    const dark = surfaceAt('hook', []);
    const below = judged('below');
    const above = judged('above');

    const diagnosis = diagnosisOf({
      reach: unbound,
      hook: dark,
      attention: { ...above, stage: 'attention' },
      transmission: { ...below, stage: 'transmission' },
      audience: { ...dark, stage: 'audience' },
      monetisation: { ...dark, stage: 'monetisation' },
    });

    expect(diagnosis).toMatchObject({
      kind: 'pattern',
      pattern: 'attention_above_transmission_below',
    });
    expect(diagnosis.coverage.judgedCount).toBe(2);
    expect(diagnosis.coverage.sentence).toMatch(/^Judged on 2 of 6 stages\./);
  });
});

describe('claim wording', () => {
  const finding = (claim: GenomeFinding['evidence']['claim']) =>
    ({
      attribute: {
        kind: 'genome',
        layer: 'semantic',
        dimension: 'framing',
        value: 'identity',
        tag: 'framing:identity',
        source: 'tag',
      },
      inseparableFrom: [],
      direction: 'higher',
      evidence: { adjustedLift: 1.7, stage: 'transmission', claim },
      testedBy: [],
    }) as unknown as GenomeFinding;

  it('reads differently for each strength', () => {
    const observed = claimSentence(finding({ strength: 'observed' }));
    const controlled = claimSentence(
      finding({
        strength: 'controlled_association',
      } as GenomeFinding['evidence']['claim']),
    );
    const causal = claimSentence(
      finding({
        strength: 'causal',
        backing: {
          kind: 'change_log',
          id: 'e1',
          concludedOn: '2026-09-01T00:00:00Z',
          outcome: 'confirmed',
        },
      } as unknown as GenomeFinding['evidence']['claim']),
    );

    expect(observed).toBe(
      'Videos tagged framing: identity had 1.7x typical transmission',
    );
    expect(controlled).toBe(
      'Among comparable videos, framing: identity is associated with 1.7x transmission',
    );
    expect(causal).toBe(
      'Changing to framing: identity increased transmission (concluded Change log entry, 2026-09-01)',
    );
    expect(new Set([observed, controlled, causal]).size).toBe(3);
  });
});
