/**
 * The content genome's comparison (FILM-1717 v1).
 *
 * Not "what do winners have?" but "what do winners have that comparable
 * losers don't?":
 *
 * ```
 * identity framing:   winners 42%   comparable losers 13%   ← discriminates
 * face present:       winners 71%   comparable losers 68%   ← tells you nothing
 * ```
 *
 * Every figure here is computed over rows `querySegmentVideoMeasures`
 * returns — FILM-1606's segment query, with its checkpoint, maturity and
 * ingest rules, and a stage-aware measure. This module never decides which
 * videos count or what their figure is; it only splits them into winners and
 * losers and compares. Its median is ClickHouse's `quantileExactInclusive`,
 * reproduced exactly, and `verify-queries.ts` checks the two agree on a real
 * server so they cannot drift.
 *
 * Pure and client-safe.
 */
import type { AnalyticsPlatform } from '../types';
import { quantileInclusive } from './channel-experiments';
import type { FormatFamily } from './format-families';
import type { DurationBand, GenomeAttribute } from './genome-attributes';
import {
  DURATION_DIMENSION,
  durationAttribute,
  durationBandOf,
  splitVideoTags,
  withEditStyle,
} from './genome-attributes';
import type { EditStyleFigures } from './genome-attributes';
import type {
  ClaimStrength,
  ComparableDefinition,
  ComparableVideo,
  Evidence,
  GenomeFinding,
} from './genome-evidence';
import {
  EVIDENCE_LEVEL_BY_CONFIDENCE,
  liftPair,
  rankingDistance,
} from './genome-evidence';
import type { MetricProvenance, SegmentMeasure } from './genome-measures';
import { resolveConfidence } from './segment-stats';
import type { FunnelStage } from './signal-map';

/**
 * Prevalence points between winners and comparable losers below which an
 * attribute is "common to both" and not a finding. 71% against 68% is three
 * points; at the sample sizes a channel has, one or two videos crossing the
 * median moves a share by more than that, so a gap under twenty points is
 * indistinguishable from where the median happened to fall.
 */
export const MIN_PREVALENCE_GAP = 0.2;

/** One video, as the segment query measured it at the checkpoint. */
export interface GenomeVideo {
  videoId: string;
  connectionId: string;
  platform: AnalyticsPlatform;
  formatFamily: FormatFamily;
  assetDurationSeconds: number | null;
  tags: readonly string[];
  /** The stage measure; null when the platform did not report it for this video. */
  value: number | null;
  /**
   * Its episode's latest delivered StorybookStudio edit (FILM-2006); absent
   * or null when it was never edited there, which adds no attribute.
   */
  editStyle?: EditStyleFigures | null;
}

/**
 * `observed` compares within the channel and format family; `controlled`
 * also holds duration band and topic fixed, so one attribute varies.
 */
export type GenomeControl = 'observed' | 'controlled';

export type GenomeNonFindingReason =
  /** Present in winners and comparable losers alike. */
  | 'common_to_winners_and_losers'
  | 'no_tagged_winners'
  | 'no_tagged_losers'
  /** More common among winners, yet its median is not above typical — or the reverse. */
  | 'direction_disagrees'
  /** The cohort median is zero, so no lift exists. */
  | 'zero_baseline';

export interface GenomeNonFinding {
  attribute: GenomeAttribute;
  reason: GenomeNonFindingReason;
  n: number;
  prevalence: { winners: number; losers: number } | null;
}

export interface GenomeStratum {
  comparable: ComparableDefinition;
  cohortN: number;
  typical: number;
  findings: GenomeFinding[];
  nonFindings: GenomeNonFinding[];
}

export interface GenomeAnalysis {
  stage: FunnelStage;
  signal: SegmentMeasure;
  checkpointDays: number;
  control: GenomeControl;
  /** Videos with a figure. */
  measuredCount: number;
  /** Videos the platform reported no figure for: excluded, never zero. */
  unmeasuredCount: number;
  /**
   * Measured videos a controlled comparison could not place: length unknown,
   * or no topic. Counted, so a thin result can be explained.
   */
  uncontrolledCount: number;
  strata: GenomeStratum[];
  /** Every finding across strata, strongest adjusted lift first. */
  findings: GenomeFinding[];
}

/**
 * ClickHouse's `quantileExactInclusive(p)`: linear interpolation at
 * position (n − 1)·p over the sorted values. The segment query's medians are
 * this function, so the genome's must be too. The arithmetic is FILM-1724's
 * `quantileInclusive`, one implementation; this sorts first and answers NaN
 * for no values.
 */
export function quantileExactInclusive(
  values: readonly number[],
  p: number,
): number {
  if (values.length === 0) return Number.NaN;

  return quantileInclusive(
    [...values].sort((a, b) => a - b),
    p,
  );
}

interface MeasuredVideo {
  videoId: string;
  value: number;
  attributes: GenomeAttribute[];
  topics: string[];
  durationBand: DurationBand | null;
  connectionId: string;
  platform: string;
  formatFamily: string;
}

function measured(video: GenomeVideo): MeasuredVideo | null {
  if (video.value === null || !Number.isFinite(video.value)) return null;

  const { taxonomy, genome } = splitVideoTags(video.tags);
  const duration = durationAttribute(video.assetDurationSeconds);
  const attributes = withEditStyle(genome, video.editStyle);

  return {
    videoId: video.videoId,
    value: video.value,
    attributes: duration ? [...attributes, duration] : attributes,
    topics: taxonomy
      .filter((tag) => tag.dimension === 'topic')
      .map((tag) => tag.value)
      .sort(),
    durationBand: durationBandOf(video.assetDurationSeconds),
    connectionId: video.connectionId,
    platform: video.platform,
    formatFamily: video.formatFamily,
  };
}

function comparableFor(
  video: MeasuredVideo,
  control: GenomeControl,
  checkpointDays: number,
): ComparableDefinition | null {
  const base = {
    connectionId: video.connectionId,
    platform: video.platform,
    formatFamily: video.formatFamily,
    checkpointDays,
  };

  if (control === 'observed') {
    return { ...base, durationBand: null, topic: null };
  }

  // A video with no topic, or no known length, cannot be shown to be
  // comparable to anything on those axes.
  if (!video.durationBand || video.topics.length === 0) return null;

  return {
    ...base,
    durationBand: video.durationBand,
    topic: video.topics.join('+'),
  };
}

function stratumKey(comparable: ComparableDefinition): string {
  return [
    comparable.connectionId,
    comparable.platform,
    comparable.formatFamily,
    comparable.durationBand ?? '*',
    comparable.topic ?? '*',
  ].join('|');
}

function claimFor(comparable: ComparableDefinition): ClaimStrength {
  if (comparable.durationBand !== null && comparable.topic !== null) {
    return {
      strength: 'controlled_association',
      controls: {
        ...comparable,
        durationBand: comparable.durationBand,
        topic: comparable.topic,
      },
    };
  }

  return { strength: 'observed' };
}

function byValueDescending(a: ComparableVideo, b: ComparableVideo): number {
  return b.value - a.value || a.videoId.localeCompare(b.videoId);
}

function compareStratum(input: {
  videos: MeasuredVideo[];
  comparable: ComparableDefinition;
  control: GenomeControl;
  stage: FunnelStage;
  signal: SegmentMeasure;
  provenance: MetricProvenance;
}): GenomeStratum {
  const { videos, comparable, control, stage, signal, provenance } = input;

  const typical = quantileExactInclusive(
    videos.map((video) => video.value),
    0.5,
  );
  const winners = new Set(
    videos.filter((video) => video.value > typical).map((v) => v.videoId),
  );
  const losers = new Set(
    videos.filter((video) => video.value < typical).map((v) => v.videoId),
  );

  // A controlled stratum holds duration fixed, so every video in it carries
  // the same band — present in all winners and all losers by construction.
  const attributes = new Map<string, GenomeAttribute>();
  for (const video of videos) {
    for (const attribute of video.attributes) {
      if (
        control === 'controlled' &&
        attribute.dimension === DURATION_DIMENSION
      )
        continue;
      attributes.set(attribute.tag, attribute);
    }
  }

  const findings: GenomeFinding[] = [];
  const nonFindings: GenomeNonFinding[] = [];

  for (const attribute of [...attributes.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag),
  )) {
    // Only videos tagged in this dimension at all: an untagged video is
    // unknown, not a video without the attribute.
    const tagged = videos.filter((video) =>
      video.attributes.some((a) => a.dimension === attribute.dimension),
    );
    const withIt = tagged.filter((video) =>
      video.attributes.some((a) => a.tag === attribute.tag),
    );
    const n = withIt.length;

    const winnersTagged = tagged.filter((v) => winners.has(v.videoId)).length;
    const losersTagged = tagged.filter((v) => losers.has(v.videoId)).length;
    const winnersWith = withIt.filter((v) => winners.has(v.videoId)).length;
    const losersWith = withIt.filter((v) => losers.has(v.videoId)).length;

    if (typical <= 0) {
      nonFindings.push({
        attribute,
        reason: 'zero_baseline',
        n,
        prevalence: null,
      });
      continue;
    }
    if (winnersTagged === 0) {
      nonFindings.push({
        attribute,
        reason: 'no_tagged_winners',
        n,
        prevalence: null,
      });
      continue;
    }
    if (losersTagged === 0) {
      nonFindings.push({
        attribute,
        reason: 'no_tagged_losers',
        n,
        prevalence: null,
      });
      continue;
    }

    const prevalence = {
      winners: winnersWith / winnersTagged,
      losers: losersWith / losersTagged,
    };
    const gap = prevalence.winners - prevalence.losers;

    if (Math.abs(gap) < MIN_PREVALENCE_GAP) {
      nonFindings.push({
        attribute,
        reason: 'common_to_winners_and_losers',
        n,
        prevalence,
      });
      continue;
    }

    const attributeMedian = quantileExactInclusive(
      withIt.map((video) => video.value),
      0.5,
    );
    const lifts = liftPair(attributeMedian, typical, n);
    const direction = gap > 0 ? 'higher' : 'lower';

    if (
      (direction === 'higher' && lifts.observedLift <= 1) ||
      (direction === 'lower' && lifts.observedLift >= 1)
    ) {
      nonFindings.push({
        attribute,
        reason: 'direction_disagrees',
        n,
        prevalence,
      });
      continue;
    }

    const evidence: Evidence = {
      level: EVIDENCE_LEVEL_BY_CONFIDENCE[resolveConfidence(n)],
      n,
      cohortN: videos.length,
      comparable,
      claim: claimFor(comparable),
      stage,
      signal,
      typical,
      attributeMedian,
      ...lifts,
      successful: withIt
        .filter((video) => winners.has(video.videoId))
        .map(({ videoId, value }) => ({ videoId, value }))
        .sort(byValueDescending),
      unsuccessful: withIt
        .filter((video) => losers.has(video.videoId))
        .map(({ videoId, value }) => ({ videoId, value }))
        .sort(byValueDescending),
      sourceRows: videos.map((video) => ({
        videoId: video.videoId,
        value: video.value,
        hasAttribute: withIt.includes(video),
      })),
      provenance,
    };

    findings.push({
      attribute,
      inseparableFrom: [],
      direction,
      prevalence: {
        ...prevalence,
        winnersWith,
        winnersTagged,
        losersWith,
        losersTagged,
      },
      evidence,
      testedBy: [],
    });
  }

  return {
    comparable,
    cohortN: videos.length,
    typical,
    findings: mergeInseparable(findings),
    nonFindings,
  };
}

/**
 * Two attributes carried by exactly the same videos cannot be told apart:
 * whatever one "explains", the other explains identically. They become one
 * finding naming both, never two independent ones.
 */
function mergeInseparable(findings: GenomeFinding[]): GenomeFinding[] {
  const groups = new Map<string, GenomeFinding[]>();

  for (const finding of findings) {
    const key = finding.evidence.sourceRows
      .filter((row) => row.hasAttribute)
      .map((row) => row.videoId)
      .sort()
      .join(',');
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  return [...groups.values()].map(([first, ...rest]) => ({
    ...first!,
    inseparableFrom: rest.map((finding) => finding.attribute),
  }));
}

/**
 * Which mechanisms separate a channel's winners from its comparable losers
 * at one stage. `videos` are the rows `querySegmentVideoMeasures` returned
 * for one channel and format family, measured on `signal`.
 */
export function analyseGenome(input: {
  videos: readonly GenomeVideo[];
  stage: FunnelStage;
  signal: SegmentMeasure;
  checkpointDays: number;
  control: GenomeControl;
  provenance: MetricProvenance;
}): GenomeAnalysis {
  const { stage, signal, checkpointDays, control, provenance } = input;

  const measuredVideos: MeasuredVideo[] = [];
  let unmeasuredCount = 0;
  for (const video of input.videos) {
    const row = measured(video);
    if (row) measuredVideos.push(row);
    else unmeasuredCount += 1;
  }

  const strata = new Map<
    string,
    { comparable: ComparableDefinition; videos: MeasuredVideo[] }
  >();
  let uncontrolledCount = 0;

  for (const video of measuredVideos) {
    const comparable = comparableFor(video, control, checkpointDays);
    if (!comparable) {
      uncontrolledCount += 1;
      continue;
    }

    const key = stratumKey(comparable);
    const stratum = strata.get(key) ?? { comparable, videos: [] };
    stratum.videos.push(video);
    strata.set(key, stratum);
  }

  const results = [...strata.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, stratum]) =>
      compareStratum({ ...stratum, control, stage, signal, provenance }),
    );

  const findings = results
    .flatMap((stratum) => stratum.findings)
    .sort(
      (a, b) =>
        rankingDistance(b.evidence) - rankingDistance(a.evidence) ||
        b.evidence.n - a.evidence.n ||
        a.attribute.tag.localeCompare(b.attribute.tag),
    );

  return {
    stage,
    signal,
    checkpointDays,
    control,
    measuredCount: measuredVideos.length,
    unmeasuredCount,
    uncontrolledCount,
    strata: results,
    findings,
  };
}
