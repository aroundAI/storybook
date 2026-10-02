/**
 * The stage-aware measure (FILM-1717).
 *
 * The genome's correlation is FILM-1606's segment query, unchanged except for
 * what it measures: a hook mechanism is scored against the Hook stage, not
 * against views. Which figure answers a stage is FILM-1714's signal map — the
 * stage's primary signal on that platform and format — so the genome cannot
 * pick a different figure from the one the stage strip shows.
 *
 * Only some signals can be read per video at a checkpoint from the tables
 * the segment query already joins. A stage whose primary signal is not one of
 * them is refused by name, never scored on a stand-in.
 *
 * Pure and client-safe.
 */
import type { AnalyticsPlatform } from '../types';
import type {
  CapabilityCitation,
  DerivationMethod,
  MetricFamily,
  SourceTable,
  SupportLevel,
} from './data-provenance';
import { CAPABILITY_MATRIX } from './data-provenance';
import type { FormatFamily } from './format-families';
import type { FunnelStage, SignalId } from './signal-map';
import { SIGNALS, SIGNAL_MAP, signalSupport } from './signal-map';

/**
 * Signals the segment query can compute per video over its first N days.
 * Each is a function of the per-video sums `segmentPerVideoSql` already
 * produces — see `SEGMENT_MEASURE_SQL` in `queries-advanced.ts`, which must
 * name exactly these.
 */
export const SEGMENT_MEASURES = [
  'impressions',
  'impressions_ctr',
  'average_view_duration',
  'share_rate',
  'comment_rate',
  'subscriber_conversion',
] as const satisfies readonly SignalId[];

export type SegmentMeasure = (typeof SEGMENT_MEASURES)[number];

export function isSegmentMeasure(signal: string): signal is SegmentMeasure {
  return (SEGMENT_MEASURES as readonly string[]).includes(signal);
}

/** Why a stage cannot be scored for an attribute on this platform and format. */
export type StageMeasureRefusal =
  | {
      kind: 'stage_unbound';
      /** FILM-1714's sentence: the platform or format has no such figure. */
      note: string;
    }
  | {
      kind: 'signal_not_ingested';
      signal: SignalId;
      blockers: readonly string[];
    }
  | {
      kind: 'no_checkpoint_measure';
      /** Bound and ingested, but not readable per video at a checkpoint yet. */
      signal: SignalId;
    };

export type StageMeasure =
  | { ok: true; stage: FunnelStage; signal: SegmentMeasure }
  | { ok: false; stage: FunnelStage; refusal: StageMeasureRefusal };

/**
 * The figure an attribute is scored on at `stage`, on one platform and
 * format: the stage's primary signal, if it is ingested and readable per
 * video at a checkpoint.
 */
export function stageMeasureFor(input: {
  platform: AnalyticsPlatform;
  formatFamily: FormatFamily;
  stage: FunnelStage;
}): StageMeasure {
  const { platform, formatFamily, stage } = input;
  const binding = SIGNAL_MAP[platform][formatFamily][stage];

  if (binding.primary === null) {
    return {
      ok: false,
      stage,
      refusal: { kind: 'stage_unbound', note: binding.note },
    };
  }

  const support = signalSupport(binding.primary, platform);

  if (support.level === 'not_ingested' || support.level === 'unsupported') {
    return {
      ok: false,
      stage,
      refusal: {
        kind: 'signal_not_ingested',
        signal: binding.primary,
        blockers: support.blockers,
      },
    };
  }

  if (!isSegmentMeasure(binding.primary)) {
    return {
      ok: false,
      stage,
      refusal: { kind: 'no_checkpoint_measure', signal: binding.primary },
    };
  }

  return { ok: true, stage, signal: binding.primary };
}

/** One input family of a measure, as the capability matrix records it. */
export interface MetricProvenanceInput {
  family: MetricFamily;
  level: SupportLevel;
  /** The ClickHouse table it is ingested into; null when it is not. */
  table: SourceTable | null;
  /** How a `derived` figure is computed from what the platform reports. */
  method: DerivationMethod | null;
  /** The vendor's own field names, from the capability reference. */
  providerFields: readonly string[];
  /** Where in `docs/platform-capability-reference.md` those names are cited. */
  reference: CapabilityCitation;
}

/**
 * Where a measure came from: the signal, every provider field it reads, the
 * table each is ingested into and how. Built from FILM-1703's matrix and
 * FILM-1714's signal definitions, never written by hand, so it cannot name a
 * field the ingest does not read.
 */
export interface MetricProvenance {
  signal: SignalId;
  platform: AnalyticsPlatform;
  /** The weakest of the inputs (FILM-1714). */
  level: SupportLevel;
  /** The signal's one-sentence definition, for a creator. */
  definition: string;
  /** Non-empty: a measure always reads at least one family. */
  inputs: readonly [MetricProvenanceInput, ...MetricProvenanceInput[]];
  /** The path from the provider to this figure. */
  ingestionPath: string;
}

export function metricProvenanceFor(
  signal: SignalId,
  platform: AnalyticsPlatform,
): MetricProvenance {
  const definition = SIGNALS[signal];
  const support = signalSupport(signal, platform);

  const [first, ...rest] = definition.inputs.map(
    (family): MetricProvenanceInput => {
      const capability = CAPABILITY_MATRIX[family][platform];

      return {
        family,
        level: capability.level,
        table: capability.table,
        method: capability.method ?? null,
        providerFields: capability.reference.fields,
        reference: capability.reference,
      };
    },
  );

  const inputs = [first!, ...rest] as const;

  const ingestionPath = inputs
    .map((input) => {
      const fields = input.providerFields.join(', ') || 'no field';
      const stored = input.table ?? 'not stored';
      const how = input.method ? ` (${input.method})` : '';

      return `${input.reference.surface ?? input.reference.section}: ${fields} → ${stored}${how}`;
    })
    .join('; ');

  return {
    signal,
    platform,
    level: support.level,
    definition: definition.definition,
    inputs,
    ingestionPath,
  };
}
