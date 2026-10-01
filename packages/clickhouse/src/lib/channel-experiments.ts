/**
 * Channel experiments (FILM-1724): which of a channel's styles work.
 *
 * A creator tags each new upload with a style; this module compares the
 * styles, each video measured at the same age as the others. Pure: the
 * per-video figures arrive already measured (or with the reason they are
 * not), so every statistical rule here is testable without a database.
 *
 * Three rules shape everything below.
 *
 * - **Unknown is a state, never a zero.** A video younger than a checkpoint
 *   is `pending`; one that cannot be measured says why. Neither enters a
 *   median, and each style reports how many of each it has.
 * - **No verdict until every style has enough.** The threshold is
 *   FILM-1715's `MIN_MATURE_VIDEOS` (FILM-1606's directional floor), not a
 *   second number. Below it the page says how many more each style needs.
 * - **Ahead only where the ranges do not overlap.** The range is the
 *   interquartile band FILM-1715 uses (`bandFor`: inclusive at both ends),
 *   so touching ranges overlap. Nothing is ranked by median alone, and
 *   there is no composite score across measures.
 *
 * What a comparison may claim depends on the experiment's state: while it
 * runs, results are associations between styles and outcomes on this
 * channel. Only a concluded experiment is evidence of cause — the styles
 * were varied on purpose and assigned with a balancing suggestion — and
 * even then topic, timing and seasonality were not controlled.
 */
import { MIN_MATURE_VIDEOS } from './cohort-growth';
import type { FormatFamily } from './format-families';
import { resolveConfidence } from './segment-stats';
import type { SegmentConfidence } from './segment-stats';
import type { NotJudgableReason } from './self-benchmark';

export const EXPERIMENT_MEASURES = [
  'views',
  'ctr',
  'avg_view_percentage',
  'subscribers_per_1000_views',
  'hook_retention_3s',
] as const;

export type ExperimentMeasure = (typeof EXPERIMENT_MEASURES)[number];

export function isExperimentMeasure(value: string): value is ExperimentMeasure {
  return (EXPERIMENT_MEASURES as readonly string[]).includes(value);
}

interface ExperimentMeasureDefinition {
  label: string;
  /**
   * The ages each measure is read at (FILM-1724 §4). Each is then passed
   * through FILM-1715's per-platform capability (`judgeSubjectCheckpoint`),
   * so a platform that cannot serve an age says so per video.
   */
  checkpoints: readonly number[];
  unit: 'views' | 'ratio' | 'percent' | 'per_thousand';
  /** Only offered for these families; `null` for every family. */
  families: readonly FormatFamily[] | null;
}

export const EXPERIMENT_MEASURE_DEFINITIONS: Record<
  ExperimentMeasure,
  ExperimentMeasureDefinition
> = {
  views: {
    label: 'Views',
    checkpoints: [7, 30],
    unit: 'views',
    families: null,
  },
  ctr: {
    label: 'Impressions click-through rate, first 7 days',
    checkpoints: [7],
    unit: 'ratio',
    families: null,
  },
  avg_view_percentage: {
    label: 'Average percentage viewed, first 7 days',
    checkpoints: [7],
    unit: 'percent',
    families: null,
  },
  subscribers_per_1000_views: {
    label: 'Net subscribers per 1,000 views, first 30 days',
    checkpoints: [30],
    unit: 'per_thousand',
    families: null,
  },
  /**
   * Retention 3 seconds in (spec §6), from the latest curve. A curve is
   * 1% steps of the video's length, so a 3-second point exists only for
   * short-form; the table refuses it elsewhere too.
   */
  hook_retention_3s: {
    label: 'Viewers still watching at 3 seconds (latest curve)',
    checkpoints: [7],
    unit: 'ratio',
    families: ['short_vertical'],
  },
};

/**
 * The longest video a 3-second point is read for. A curve is 1% steps of
 * the video, so at 150 seconds its points are 1.5s apart and 3s falls on
 * the curve; a 10-minute video's first point is at 6s (spec §6).
 */
export const HOOK_MAX_DURATION_SECONDS = 150;

/** Measured videos every style needs at a checkpoint before any verdict. */
export const EXPERIMENT_VERDICT_MIN = MIN_MATURE_VIDEOS;

/** Why a video has no figure at a checkpoint, other than being too young. */
export type NotMeasurableReason =
  | Exclude<NotJudgableReason, { kind: 'too_young' }>
  /** The window has no data for this measure (no impressions, say). */
  | { kind: 'no_data' }
  /** The platform does not report this measure (KB-111). */
  | { kind: 'not_reported_by_platform' }
  /** The video is not in the analytics store yet. */
  | { kind: 'not_ingested' }
  /** Its family changed after assignment (a known duration refined it). */
  | { kind: 'format_changed'; family: FormatFamily | null }
  /** Hook measure: the published asset's length is unknown (FILM-1710). */
  | { kind: 'duration_unknown' }
  /** Hook measure: too long for the curve to resolve 3 seconds. */
  | { kind: 'too_long_for_hook'; seconds: number }
  /** Hook measure: no retention curve has been fetched. */
  | { kind: 'no_curve' };

/** One video at one checkpoint of one measure. */
export type VideoMeasurement =
  | { state: 'measured'; value: number }
  | { state: 'pending'; judgableOn: string }
  | { state: 'not_measurable'; reason: NotMeasurableReason };

export interface ExperimentVideoInput {
  publishId: string;
  styleId: string;
  /** Keyed `${measure}@${checkpointDays}`. */
  measurements: Record<string, VideoMeasurement>;
}

export function measurementKey(
  measure: ExperimentMeasure,
  checkpointDays: number,
): string {
  return `${measure}@${checkpointDays}`;
}

/** The interquartile range of the measured figures, with its median. */
export interface StyleDistribution {
  p25: number;
  median: number;
  p75: number;
}

export interface StyleSummary {
  styleId: string;
  name: string;
  measured: number;
  pending: number;
  notMeasurable: number;
  /** Null until at least one video is measured: no median of nothing. */
  distribution: StyleDistribution | null;
  /** FILM-1606's tier for `measured`, so a thin style is labelled as one. */
  confidence: SegmentConfidence;
}

export type PairRelation = 'ahead' | 'behind' | 'no_clear_difference';

export interface StylePair {
  styleId: string;
  otherStyleId: string;
  /** How `styleId` stands against `otherStyleId`. */
  relation: PairRelation;
}

export type CheckpointVerdict =
  | {
      kind: 'too_few';
      threshold: number;
      /** Every style below the threshold, and how many more it needs. */
      needs: { styleId: string; more: number }[];
    }
  | {
      kind: 'compared';
      threshold: number;
      /** Every ordered pair, both directions. */
      pairs: StylePair[];
      /** False means "no clear difference yet" between any two styles. */
      anyClearDifference: boolean;
    };

export interface MeasureCheckpointResult {
  measure: ExperimentMeasure;
  checkpointDays: number;
  styles: StyleSummary[];
  verdict: CheckpointVerdict;
}

export interface ChannelExperimentResults {
  version: 1;
  /** When the figures were read. */
  asOf: string;
  results: MeasureCheckpointResult[];
}

/**
 * A quantile by linear interpolation between closest ranks (Hyndman–Fan
 * type 7, ClickHouse's `quantileExactInclusive`). `sorted` is ascending
 * and non-empty.
 */
export function quantileInclusive(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower]!;

  return low + (sorted[upper]! - low) * (position - lower);
}

export function summariseStyle(
  style: { id: string; name: string },
  measurements: readonly VideoMeasurement[],
): StyleSummary {
  const values: number[] = [];
  let pending = 0;
  let notMeasurable = 0;

  for (const measurement of measurements) {
    if (measurement.state === 'measured') values.push(measurement.value);
    else if (measurement.state === 'pending') pending += 1;
    else notMeasurable += 1;
  }

  values.sort((a, b) => a - b);

  return {
    styleId: style.id,
    name: style.name,
    measured: values.length,
    pending,
    notMeasurable,
    distribution:
      values.length === 0
        ? null
        : {
            p25: quantileInclusive(values, 0.25),
            median: quantileInclusive(values, 0.5),
            p75: quantileInclusive(values, 0.75),
          },
    confidence: resolveConfidence(values.length),
  };
}

/** Ahead only where the ranges do not touch: `bandFor` is inclusive, so this is too. */
export function relationBetween(
  style: StyleDistribution,
  other: StyleDistribution,
): PairRelation {
  if (style.p25 > other.p75) return 'ahead';
  if (style.p75 < other.p25) return 'behind';

  return 'no_clear_difference';
}

export function verdictFor(
  styles: readonly StyleSummary[],
  threshold: number = EXPERIMENT_VERDICT_MIN,
): CheckpointVerdict {
  const needs = styles
    .filter((style) => style.measured < threshold)
    .map((style) => ({
      styleId: style.styleId,
      more: threshold - style.measured,
    }));

  if (needs.length > 0) return { kind: 'too_few', threshold, needs };

  const pairs: StylePair[] = [];

  for (const style of styles) {
    for (const other of styles) {
      if (style.styleId === other.styleId) continue;

      pairs.push({
        styleId: style.styleId,
        otherStyleId: other.styleId,
        // At or above the threshold every style has a distribution.
        relation: relationBetween(style.distribution!, other.distribution!),
      });
    }
  }

  return {
    kind: 'compared',
    threshold,
    pairs,
    anyClearDifference: pairs.some(
      (pair) => pair.relation !== 'no_clear_difference',
    ),
  };
}

/** The measures × checkpoints an experiment reports, in a stable order. */
export function experimentCheckpoints(
  measures: readonly ExperimentMeasure[],
): { measure: ExperimentMeasure; checkpointDays: number }[] {
  return EXPERIMENT_MEASURES.filter((measure) =>
    measures.includes(measure),
  ).flatMap((measure) =>
    EXPERIMENT_MEASURE_DEFINITIONS[measure].checkpoints.map(
      (checkpointDays) => ({ measure, checkpointDays }),
    ),
  );
}

/** Every style's summary and the verdict, at every measure and checkpoint. */
export function compareStyles(input: {
  styles: readonly { id: string; name: string }[];
  videos: readonly ExperimentVideoInput[];
  measures: readonly ExperimentMeasure[];
  asOf: Date;
  threshold?: number;
}): ChannelExperimentResults {
  const results = experimentCheckpoints(input.measures).map(
    ({ measure, checkpointDays }) => {
      const key = measurementKey(measure, checkpointDays);
      const styles = input.styles.map((style) =>
        summariseStyle(
          style,
          input.videos
            .filter((video) => video.styleId === style.id)
            .map(
              (video) =>
                video.measurements[key] ?? {
                  state: 'not_measurable' as const,
                  reason: { kind: 'no_data' as const },
                },
            ),
        ),
      );

      return {
        measure,
        checkpointDays,
        styles,
        verdict: verdictFor(styles, input.threshold),
      };
    },
  );

  return { version: 1, asOf: input.asOf.toISOString(), results };
}

/** What a comparison may claim, by the experiment's state. */
export type ExperimentEvidenceKind = 'association' | 'concluded_experiment';

export function evidenceKindOf(status: string): ExperimentEvidenceKind {
  return status === 'concluded' ? 'concluded_experiment' : 'association';
}

/**
 * A concluded channel experiment: the one form of this feature a causal
 * claim may cite (owner, 2026-09-24 — FILM-1717/1718/1719 name which kind
 * backs a claim, this or a concluded Change log entry). `results` is the
 * snapshot frozen at conclusion, never a later re-read.
 */
export interface ConcludedChannelExperiment {
  kind: 'concluded_channel_experiment';
  experimentId: string;
  accountId: string;
  connectionId: string;
  formatFamily: FormatFamily;
  title: string;
  hypothesis: string | null;
  expectedOutcome: string | null;
  startedAt: string;
  endedAt: string;
  conclusion: string | null;
  outcomeStatus: 'confirmed' | 'rejected' | 'inconclusive';
  styles: { id: string; name: string; description: string | null }[];
  results: ChannelExperimentResults;
}

/** The row fields `toConcludedChannelExperiment` reads. */
export interface ChannelExperimentRecord {
  id: string;
  account_id: string;
  connection_id: string;
  format_family: string;
  title: string;
  hypothesis: string | null;
  expected_outcome: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  conclusion: string | null;
  outcome_status: string;
  result_snapshot: unknown;
  styles: { id: string; name: string; description: string | null }[];
}

function isResults(value: unknown): value is ChannelExperimentResults {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    Array.isArray((value as { results?: unknown }).results)
  );
}

/**
 * The record as causal evidence, or null when it is not evidence: not
 * concluded, or concluded without a result the table recorded. A running
 * experiment can never be passed where this type is required.
 */
export function toConcludedChannelExperiment(
  record: ChannelExperimentRecord,
): ConcludedChannelExperiment | null {
  if (
    record.status !== 'concluded' ||
    !record.started_at ||
    !record.ended_at ||
    !isResults(record.result_snapshot)
  ) {
    return null;
  }

  const outcome = record.outcome_status;

  return {
    kind: 'concluded_channel_experiment',
    experimentId: record.id,
    accountId: record.account_id,
    connectionId: record.connection_id,
    formatFamily: record.format_family as FormatFamily,
    title: record.title,
    hypothesis: record.hypothesis,
    expectedOutcome: record.expected_outcome,
    startedAt: record.started_at,
    endedAt: record.ended_at,
    conclusion: record.conclusion,
    outcomeStatus:
      outcome === 'confirmed' || outcome === 'rejected'
        ? outcome
        : 'inconclusive',
    styles: record.styles,
    results: record.result_snapshot,
  };
}

/** One style ahead of another where their ranges did not overlap. */
export interface ExperimentFinding {
  basis: 'concluded_channel_experiment';
  experimentId: string;
  measure: ExperimentMeasure;
  checkpointDays: number;
  aheadStyleId: string;
  behindStyleId: string;
  aheadMeasured: number;
  behindMeasured: number;
}

/**
 * The findings a concluded experiment supports: only pairs whose ranges
 * did not overlap, only where every style cleared the threshold. Takes the
 * concluded type, so a running experiment's associations cannot become one.
 */
export function experimentFindings(
  experiment: ConcludedChannelExperiment,
): ExperimentFinding[] {
  return experiment.results.results.flatMap((result) => {
    const { verdict } = result;
    if (verdict.kind !== 'compared') return [];

    const measured = new Map(
      result.styles.map((style) => [style.styleId, style.measured]),
    );

    return verdict.pairs
      .filter((pair) => pair.relation === 'ahead')
      .map((pair) => ({
        basis: 'concluded_channel_experiment' as const,
        experimentId: experiment.experimentId,
        measure: result.measure,
        checkpointDays: result.checkpointDays,
        aheadStyleId: pair.styleId,
        behindStyleId: pair.otherStyleId,
        aheadMeasured: measured.get(pair.styleId) ?? 0,
        behindMeasured: measured.get(pair.otherStyleId) ?? 0,
      }));
  });
}
