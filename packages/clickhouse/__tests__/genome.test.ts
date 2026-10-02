import { describe, expect, it } from 'vitest';

import { toConcludedChannelExperiment } from '../src/lib/channel-experiments';
import type { GenomeVideo } from '../src/lib/genome';
import {
  MIN_PREVALENCE_GAP,
  analyseGenome,
  quantileExactInclusive,
} from '../src/lib/genome';
import type {
  CausalBacking,
  ClaimStrength,
  Evidence,
  GenomeFinding,
  Recommendation,
} from '../src/lib/genome-evidence';
import {
  concludedChangeLogEntry,
  evidenceLabel,
  liftPair,
  rankingDistance,
  recommendFrom,
} from '../src/lib/genome-evidence';
import { metricProvenanceFor } from '../src/lib/genome-measures';

const CHANNEL = 'c0000000-0000-4000-8000-000000000001';
const provenance = metricProvenanceFor('share_rate', 'youtube');

function video(
  id: string,
  value: number | null,
  tags: string[] = [],
  assetDurationSeconds: number | null = 300,
): GenomeVideo {
  return {
    videoId: id,
    connectionId: CHANNEL,
    platform: 'youtube',
    formatFamily: 'long_horizontal',
    assetDurationSeconds,
    tags,
    value,
  };
}

function analyse(
  videos: GenomeVideo[],
  control: 'observed' | 'controlled' = 'observed',
) {
  return analyseGenome({
    videos,
    stage: 'transmission',
    signal: 'share_rate',
    checkpointDays: 30,
    control,
    provenance,
  });
}

/**
 * Forty videos valued 1..40: the median is 20.5, so 1..20 are the losers and
 * 21..40 the winners. `tagsFor(value)` decides each one's tags.
 */
function forty(tagsFor: (value: number) => string[]): GenomeVideo[] {
  return Array.from({ length: 40 }, (_, index) => {
    const value = index + 1;
    return video(`v${String(value).padStart(2, '0')}`, value, tagsFor(value));
  });
}

/**
 * face_present — the failing control. Winners: 17 tagged, 12 yes (70.6%).
 * Losers: 19 tagged, 13 yes (68.4%). The rest untagged.
 */
function facePresent(value: number): string[] {
  if (value > 20) {
    if (value <= 32) return ['face_present:yes'];
    if (value <= 37) return ['face_present:no'];
    return [];
  }
  if (value <= 13) return ['face_present:yes'];
  if (value <= 19) return ['face_present:no'];
  return [];
}

/**
 * result_first — discriminates. Winners 29..40 are yes (12 of 20 = 60%),
 * 21..28 no; losers 1..3 are yes (3 of 20 = 15%), 4..20 no.
 */
function resultFirst(value: number): string[] {
  if (value >= 29 || value <= 3) return ['result_first:yes'];
  return ['result_first:no'];
}

describe('quantileExactInclusive', () => {
  it('interpolates at (n − 1)·p, as ClickHouse does', () => {
    expect(quantileExactInclusive([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileExactInclusive([10, 40, 20, 30, 50], 0.25)).toBe(20);
    expect(quantileExactInclusive([1, 2], 0.75)).toBe(1.75);
    expect(quantileExactInclusive([], 0.5)).toBeNaN();
  });
});

describe('discriminating attributes', () => {
  it('reports nothing for an attribute in 71% of winners and 68% of comparable losers', () => {
    const analysis = analyse(forty(facePresent));
    const tags = analysis.findings.map((finding) => finding.attribute.tag);

    expect(tags).not.toContain('face_present:yes');
    expect(tags).not.toContain('face_present:no');

    const control = analysis.strata[0]!.nonFindings.find(
      (row) => row.attribute.tag === 'face_present:yes',
    );
    expect(control?.reason).toBe('common_to_winners_and_losers');
    expect(control?.prevalence?.winners).toBeCloseTo(12 / 17, 10);
    expect(control?.prevalence?.losers).toBeCloseTo(13 / 19, 10);
    expect(
      Math.abs(control!.prevalence!.winners - control!.prevalence!.losers),
    ).toBeLessThan(MIN_PREVALENCE_GAP);
  });

  it('reports an attribute winners have and comparable losers do not, with hand-computed figures', () => {
    const analysis = analyse(
      forty((value) => [...facePresent(value), ...resultFirst(value)]),
    );
    const finding = analysis.findings.find(
      (row) => row.attribute.tag === 'result_first:yes',
    );

    expect(finding).toBeDefined();
    const evidence = finding!.evidence;

    // Values with it: 1, 2, 3, 29..40 — fifteen; the 8th is 33.
    expect(finding!.direction).toBe('higher');
    expect(finding!.prevalence).toMatchObject({
      winners: 12 / 20,
      losers: 3 / 20,
      winnersWith: 12,
      winnersTagged: 20,
      losersWith: 3,
      losersTagged: 20,
    });
    expect(evidence.n).toBe(15);
    expect(evidence.cohortN).toBe(40);
    expect(evidence.typical).toBe(20.5);
    expect(evidence.attributeMedian).toBe(33);
    expect(evidence.observedLift).toBeCloseTo(33 / 20.5, 10);
    // n = 15 = the prior, so half the distance from 1x survives.
    expect(evidence.shrinkageFactor).toBe(0.5);
    expect(evidence.adjustedLift).toBeCloseTo(1 + (33 / 20.5 - 1) / 2, 10);
    expect(evidence.level).toBe('established');
  });

  it('carries both comparable sets: with the mechanism above the median, and below it', () => {
    const finding = analyse(forty(resultFirst)).findings.find(
      (row) => row.attribute.tag === 'result_first:yes',
    )!;

    expect(finding.evidence.successful.map((row) => row.value)).toEqual([
      40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29,
    ]);
    expect(finding.evidence.unsuccessful.map((row) => row.value)).toEqual([
      3, 2, 1,
    ]);
    expect(finding.evidence.sourceRows).toHaveLength(40);
    expect(
      finding.evidence.sourceRows.filter((row) => row.hasAttribute),
    ).toHaveLength(15);
  });

  it('reports the losing side of a dimension as associated with lower', () => {
    const finding = analyse(forty(resultFirst)).findings.find(
      (row) => row.attribute.tag === 'result_first:no',
    )!;

    // No on 4..28: 25 videos, median 16 — below 20.5.
    expect(finding.direction).toBe('lower');
    expect(finding.evidence.attributeMedian).toBe(16);
    expect(finding.evidence.observedLift).toBeLessThan(1);
  });

  it('treats an untagged video as unknown, not as a video without the attribute', () => {
    // Only the five best winners are tagged at all. Had the other 35 counted
    // as "no", yes would be 5/20 of winners against 0/20 of losers.
    const analysis = analyse(
      forty((value) => (value >= 36 ? ['text_present:yes'] : [])),
    );
    const row = analysis.strata[0]!.nonFindings.find(
      (entry) => entry.attribute.tag === 'text_present:yes',
    );

    expect(row?.reason).toBe('no_tagged_losers');
    expect(analysis.findings).toHaveLength(0);
  });

  it('reports nothing when an attribute is commoner among winners yet its median is below typical', () => {
    // With it: winners 21..26 (all six winners tagged: 100%) and losers
    // 1..10 (10 of 20 losers tagged: 50%). Sixteen values, median 8.5 —
    // below 20.5. The prevalence and the lift point opposite ways.
    const analysis = analyse(
      forty((value) => {
        if ((value >= 21 && value <= 26) || value <= 10) {
          return ['scene_changes:none'];
        }
        return value <= 20 ? ['scene_changes:1-to-3'] : [];
      }),
    );
    const row = analysis.strata[0]!.nonFindings.find(
      (entry) => entry.attribute.tag === 'scene_changes:none',
    );

    expect(row?.reason).toBe('direction_disagrees');
    expect(
      analysis.findings.map((finding) => finding.attribute.tag),
    ).not.toContain('scene_changes:none');
  });

  it('excludes a video the platform reported no figure for, and counts it', () => {
    const videos = [
      ...forty(resultFirst),
      video('unmeasured', null, ['result_first:yes']),
    ];
    const analysis = analyse(videos);

    expect(analysis.measuredCount).toBe(40);
    expect(analysis.unmeasuredCount).toBe(1);
    expect(
      analysis.findings.find((row) => row.attribute.tag === 'result_first:yes')
        ?.evidence.n,
    ).toBe(15);
  });

  it('does not report two attributes that always co-occur as independent findings', () => {
    const analysis = analyse(
      forty((value) =>
        value >= 29 || value <= 3
          ? ['result_first:yes', 'question_first_3s:yes']
          : ['result_first:no', 'question_first_3s:no'],
      ),
    );
    const tags = analysis.findings.map((row) => row.attribute.tag);

    expect(tags.filter((tag) => tag.endsWith(':yes'))).toHaveLength(1);
    const merged = analysis.findings.find((row) =>
      row.attribute.tag.endsWith(':yes'),
    )!;
    expect(merged.inseparableFrom.map((attribute) => attribute.tag)).toEqual([
      'result_first:yes',
    ]);
  });
});

describe('a two-video cohort cannot outrank a hundred-video one', () => {
  it('ranks by adjusted lift, which the naive observed lift gets backwards', () => {
    const small = liftPair(2.8, 1, 2);
    const large = liftPair(1.35, 1, 100);

    // The failing control: by observed lift, two videos win.
    expect(small.observedLift).toBeGreaterThan(large.observedLift);
    // Adjusted: 1.21x against 1.30x.
    expect(small.adjustedLift).toBeCloseTo(1 + 1.8 * (2 / 17), 10);
    expect(rankingDistance(large)).toBeGreaterThan(rankingDistance(small));
  });

  it('orders analyseGenome findings by adjusted lift, not observed', () => {
    // Values 1..60, median 30.5. opening_visual:a is on the two best videos
    // (median 59.5, observed 1.95x), with three losers tagged otherwise;
    // hook_type:b is on 29..58 (median 43.5, observed 1.43x).
    const videos = Array.from({ length: 60 }, (_, index) => {
      const value = index + 1;
      const tags = [value >= 29 && value <= 58 ? 'hook_type:b' : 'hook_type:c'];
      if (value >= 59) tags.push('opening_visual:a');
      if (value <= 3) tags.push('opening_visual:z');
      return video(`h${value}`, value, tags);
    });

    const findings = analyse(videos).findings;
    const a = findings.find((row) => row.attribute.tag === 'opening_visual:a')!;
    const b = findings.find((row) => row.attribute.tag === 'hook_type:b')!;

    expect(a.evidence.observedLift).toBeGreaterThan(b.evidence.observedLift);
    expect(findings.indexOf(b)).toBeLessThan(findings.indexOf(a));
    expect(a.evidence.level).toBe('observation');
  });
});

describe('claim strength', () => {
  it('a pooled comparison is observed; a stratified one is a controlled association', () => {
    const tags = (value: number) => ['topic:ai', ...resultFirst(value)];
    const observed = analyse(forty(tags)).findings[0]!;
    const controlled = analyse(forty(tags), 'controlled').findings[0]!;

    expect(observed.evidence.claim).toEqual({ strength: 'observed' });
    expect(controlled.evidence.claim).toEqual({
      strength: 'controlled_association',
      controls: {
        connectionId: CHANNEL,
        platform: 'youtube',
        formatFamily: 'long_horizontal',
        durationBand: '3-to-10m',
        topic: 'ai',
        checkpointDays: 30,
      },
    });
  });

  it('keeps videos of different lengths or topics out of each other’s controlled comparison', () => {
    const videos = [
      ...forty((value) => ['topic:ai', ...resultFirst(value)]),
      video('other-topic', 99, ['topic:cooking', 'result_first:yes']),
      video('other-length', 99, ['topic:ai', 'result_first:yes'], 30),
      video('no-topic', 99, ['result_first:yes']),
      video('no-length', 99, ['topic:ai', 'result_first:yes'], null),
    ];
    const analysis = analyse(videos, 'controlled');

    expect(analysis.uncontrolledCount).toBe(2);
    const main = analysis.strata.find(
      (stratum) =>
        stratum.comparable.topic === 'ai' &&
        stratum.comparable.durationBand === '3-to-10m',
    )!;
    expect(main.cohortN).toBe(40);
    expect(analysis.strata).toHaveLength(3);
  });

  it('a causal claim names a concluded Change log entry or channel experiment', () => {
    const running = concludedChangeLogEntry({
      id: 'e1',
      status: 'running',
      ended_at: null,
      outcome_status: 'pending',
    });
    const planned = toConcludedChannelExperiment({
      id: 'x1',
      account_id: 'a1',
      connection_id: CHANNEL,
      format_family: 'long_horizontal',
      title: 'Hooks',
      hypothesis: null,
      expected_outcome: null,
      status: 'planned',
      started_at: null,
      ended_at: null,
      conclusion: null,
      outcome_status: 'pending',
      result_snapshot: {},
      styles: [],
    });
    // Ended, with an outcome, but abandoned: not a concluded test.
    const abandoned = concludedChangeLogEntry({
      id: 'e3',
      status: 'abandoned',
      ended_at: '2026-09-01',
      outcome_status: 'inconclusive',
    });
    const entry = concludedChangeLogEntry({
      id: 'e2',
      status: 'concluded',
      ended_at: '2026-09-01',
      outcome_status: 'confirmed',
    });

    expect(running).toBeNull();
    expect(planned).toBeNull();
    expect(abandoned).toBeNull();
    expect(entry).toMatchObject({
      kind: 'change_log',
      id: 'e2',
      concludedOn: '2026-09-01',
      outcome: 'confirmed',
    });

    const claim: ClaimStrength = { strength: 'causal', backing: entry! };
    expect(claim.strength).toBe('causal');
  });

  it('does not compile a causal claim without a concluded reference', () => {
    // @ts-expect-error — causal needs a backing
    const bare: ClaimStrength = { strength: 'causal' };
    const forged: ClaimStrength = {
      strength: 'causal',
      // @ts-expect-error — an unbranded object is not a concluded entry
      backing: {
        kind: 'change_log',
        id: 'e1',
        concludedOn: '2026-09-01',
        outcome: 'confirmed',
      },
    };
    // @ts-expect-error — the backing names which kind it is
    const untyped: CausalBacking = { id: 'e1' };

    expect([bare, forged, untyped]).toHaveLength(3);
  });
});

describe('evidence', () => {
  const finding = (): GenomeFinding =>
    analyse(forty(resultFirst)).findings.find(
      (row) => row.attribute.tag === 'result_first:yes',
    )!;

  it('every evidence carries a MetricProvenance naming the provider fields and ingestion path', () => {
    const { provenance: carried } = finding().evidence;

    expect(carried.signal).toBe('share_rate');
    expect(carried.inputs[0].family).toBe('engagement');
    expect(carried.inputs[0].providerFields).toContain('shares');
    expect(carried.inputs[0].table).toBe('video_metrics');
    expect(carried.ingestionPath).toContain('video_metrics');
  });

  it('labels sparse evidence instead of hiding it', () => {
    const analysis = analyse(
      [1, 2, 3, 4, 5, 6, 7].map((value) =>
        video(`s${value}`, value, [
          value >= 6 ? 'result_first:yes' : 'result_first:no',
        ]),
      ),
    );
    const early = analysis.findings.find(
      (row) => row.attribute.tag === 'result_first:yes',
    )!;

    expect(early.evidence.level).toBe('observation');
    expect(evidenceLabel(early.evidence)).toBe(
      `Early signal — 2 videos · ${early.evidence.adjustedLift.toFixed(2)}x adjusted`,
    );
  });

  it('does not compile an Evidence without a MetricProvenance', () => {
    const { provenance: _dropped, ...rest } = finding().evidence;
    // @ts-expect-error — provenance is required
    const evidence: Evidence = rest;

    expect(evidence).toBeDefined();
  });
});

describe('recommendations', () => {
  it('are built from a finding, carrying its evidence', () => {
    const finding = analyse(forty(resultFirst)).findings.find(
      (row) => row.attribute.tag === 'result_first:yes',
    )!;
    const recommendation = recommendFrom(finding);

    expect(recommendation.action).toBe('use_more');
    expect(recommendation.evidence).toBe(finding.evidence);
    expect(recommendation.sentence).toContain('Established pattern');
  });

  it('do not compile without an Evidence', () => {
    // @ts-expect-error — no evidence, and no brand: recommendFrom is the only way
    const bare: Recommendation = {
      attribute: {
        kind: 'genome',
        layer: 'observable',
        dimension: 'result_first',
        value: 'yes',
        tag: 'result_first:yes',
        source: 'tag',
      },
      action: 'use_more',
      sentence: 'Try more result first',
    };

    expect(bare).toBeDefined();
  });
});
