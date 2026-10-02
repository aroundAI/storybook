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
import type { DenominatorStamp } from './measures';
import { chosenColumnRecord, recordViewsDenominator } from './measures';
import { viewFormatOf } from './self-benchmark';
import type { FunnelStage, SignalId } from './signal-map';
import { SIGNALS, SIGNAL_MAP, signalSupport } from './signal-map';
import type { ViewDefinitionChange, ViewsColumn } from './view-definitions';
import { viewsDenominatorFor } from './view-definitions';

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

/** The measures that divide by views, so depend on what a view is. */
export const VIEWS_RATE_MEASURES = [
  'average_view_duration',
  'share_rate',
  'comment_rate',
  'subscriber_conversion',
] as const satisfies readonly SegmentMeasure[];

function isViewsRate(measure: SegmentMeasure): boolean {
  return (VIEWS_RATE_MEASURES as readonly string[]).includes(measure);
}

/**
 * The views series a genome cohort's rates divide by (FILM-1717), chosen by
 * FILM-1722's `viewsDenominatorFor` over the dates the cohort's checkpoint
 * windows span, never here.
 *
 * - One definition throughout: `views`, as before.
 * - A change inside the span, bridged by a stored continuous series
 *   (YouTube's engaged views): that series, for every video.
 * - A change the series begins too late to bridge: the cohort starts where
 *   the series begins (`publishedFrom`), as FILM-1715's benchmark narrows
 *   its window (owner, 2026-10-01). Older videos are left out, not read on
 *   the other denominator.
 * - No series at all: refused, with the change named.
 *
 * Measures that do not divide by views (impressions, CTR), and spans the
 * registry suppresses for another reason, keep `views`: the change does not
 * reach them.
 */
export type GenomeViewsDenominator =
  | {
      ok: true;
      column: ViewsColumn;
      /** Videos published before this date (UTC) are left out; null keeps all. */
      publishedFrom: string | null;
      /** Present when the series is not `views`: the change it bridges. */
      instead: {
        reason: 'view_definition_changed';
        changedOn: string;
        changes: readonly ViewDefinitionChange[];
      } | null;
    }
  | {
      ok: false;
      refusal: {
        kind: 'view_definition_changed';
        changedOn: string;
        changes: readonly ViewDefinitionChange[];
      };
    };

const VIEWS: GenomeViewsDenominator = {
  ok: true,
  column: 'views',
  publishedFrom: null,
  instead: null,
};

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}

/**
 * The days a cohort's checkpoint windows span: its first publication to the
 * end of its last video's first `checkpointDays`, never past `asOf`. Null
 * for an empty cohort.
 */
export function cohortWindow(input: {
  publishedAt: readonly string[];
  checkpointDays: number;
  asOf: string;
}): { from: string; to: string } | null {
  if (input.publishedAt.length === 0) return null;

  const dates = input.publishedAt.map((value) => value.slice(0, 10)).sort();
  const lastWindowEnd = addDays(dates.at(-1)!, input.checkpointDays - 1);
  const asOf = input.asOf.slice(0, 10);

  return {
    from: dates[0]!,
    to: lastWindowEnd < asOf ? lastWindowEnd : asOf,
  };
}

/**
 * What a cohort's stage rate divided by (FILM-1732), for the series
 * `genomeViewsDenominator` chose: null for a measure that does not divide
 * by views, or a cohort with no videos.
 *
 * On `views` the record names every definition over the cohort's days and
 * each change it crosses, as every other rate's does. On a bridging series
 * it is that series' record from `viewsDenominatorFor`, which crosses
 * nothing. `publishedFrom` narrows the days as it narrows the cohort.
 */
export function recordCohortViewsDenominator(input: {
  platform: AnalyticsPlatform;
  formatFamily: FormatFamily;
  measure: SegmentMeasure;
  publishedAt: readonly string[];
  checkpointDays: number;
  asOf: string;
  denominator: Pick<
    GenomeViewsDenominator & { ok: true },
    'column' | 'publishedFrom'
  >;
}): DenominatorStamp | null {
  const { publishedFrom, column } = input.denominator;
  const kept = cohortWindow({
    ...input,
    publishedAt: input.publishedAt.filter(
      (value) => publishedFrom === null || value.slice(0, 10) >= publishedFrom,
    ),
  });

  if (!isViewsRate(input.measure) || kept === null) return null;

  // A narrowed cohort's series was chosen from where the narrowing starts:
  // the record covers the same days, so it names the same series.
  const span = publishedFrom === null ? kept : { ...kept, from: publishedFrom };

  if (column !== 'views') {
    const chosen = viewsDenominatorFor(input.platform, span.from, span.to, {
      format: viewFormatOf(input.formatFamily),
    });

    if (chosen.kind === 'column' && chosen.column === column) {
      return chosenColumnRecord(input.platform, chosen, span);
    }
  }

  return recordViewsDenominator({ platforms: [input.platform], window: span });
}

export function genomeViewsDenominator(input: {
  platform: AnalyticsPlatform;
  formatFamily: FormatFamily;
  measure: SegmentMeasure;
  /** The cohort's publication instants, as the segment query returns them. */
  publishedAt: readonly string[];
  checkpointDays: number;
  /** 'YYYY-MM-DD HH:MM:SS' or ISO; a window cannot run past it. */
  asOf: string;
}): GenomeViewsDenominator {
  const span = cohortWindow(input);

  if (!isViewsRate(input.measure) || span === null) return VIEWS;

  const { from, to } = span;
  const options = { format: viewFormatOf(input.formatFamily) };
  const denominator = viewsDenominatorFor(input.platform, from, to, options);

  if (denominator.kind === 'column') {
    return {
      ok: true,
      column: denominator.column,
      publishedFrom: null,
      instead: denominator.instead ?? null,
    };
  }

  if (denominator.reason !== 'view_definition_changed') return VIEWS;

  const { changedOn, changes, continuousAlternative } = denominator;
  const continuousFrom =
    continuousAlternative?.definition.effectiveFrom ?? null;

  if (
    continuousFrom !== null &&
    continuousFrom > from &&
    continuousFrom <= to
  ) {
    const narrowed = viewsDenominatorFor(
      input.platform,
      continuousFrom,
      to,
      options,
    );

    if (narrowed.kind === 'column' && narrowed.column !== 'views') {
      return {
        ok: true,
        column: narrowed.column,
        publishedFrom: continuousFrom,
        instead: { reason: 'view_definition_changed', changedOn, changes },
      };
    }
  }

  return {
    ok: false,
    refusal: { kind: 'view_definition_changed', changedOn, changes },
  };
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
    }
  | (GenomeViewsDenominator & { ok: false })['refusal'];

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
