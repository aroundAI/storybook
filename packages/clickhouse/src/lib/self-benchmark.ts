/**
 * Self-benchmarking (FILM-1715): a video against its own channel's history
 * at the same checkpoint age.
 *
 * Platform view definitions differ enough that a cross-platform percentage
 * is not comparable, so the only defensible benchmark is the channel's own
 * history. This module is the pure half of the join — what a checkpoint may
 * be judged on, the band, the lift, shrinkage, relaxation — so every rule
 * here is testable without a database. `queryVideoBenchmark` is the other
 * half and only fetches.
 *
 * The result is a band, never a percentile: `queryCohortMedians` returns
 * three quantiles, and from three quantiles a band is computable and a
 * percentile is not.
 */
import { MIN_MATURE_VIDEOS } from './cohort-growth';
import type { DataWindow } from './data-provenance';
import { capabilityFor } from './data-provenance';
import type { FormatFamily } from './format-families';
import { CONFIDENCE_REPORTABLE_MIN, resolveConfidence } from './segment-stats';
import type { SegmentConfidence } from './segment-stats';
import {
  calendarDaysBetween,
  checkpointPredatesIngest,
  computeIngestLagDays,
  computeMaturity,
} from './video-age';
import type {
  PlatformId,
  ViewFormat,
  ViewsColumn,
  ViewsDenominator,
} from './view-definitions';
import { viewsDenominatorFor } from './view-definitions';

/** The checkpoint ages a benchmark is asked for, before any platform cuts them. */
export const BENCHMARK_CHECKPOINTS = [30, 90, 180, 365] as const;

/**
 * The trailing window peers are drawn from, in months before the video's
 * own publication. Long enough that a biweekly channel clears
 * `MIN_MATURE_VIDEOS` mature videos; short enough that a format the channel
 * abandoned three years ago is not the benchmark.
 */
export const BENCHMARK_WINDOW_MONTHS = 24;

/**
 * The axes a peer set may be widened along when it is too thin. Channel and
 * format family are absent on purpose, so no relaxation can name them: a
 * peer set from another channel stops being *self*-benchmarking, and a
 * Short's band against long-form is nonsense.
 */
export type RelaxableAxis = 'window' | 'language';

export interface BenchmarkRelaxationStep {
  windowMonths: number;
  /** `same`: the video's own language (including "not set"); `any`: no filter. */
  language: 'same' | 'any';
  relaxedAxes: readonly RelaxableAxis[];
}

/**
 * Ordered and bounded: widen the window, then drop language, then stop.
 * The first step that clears `MIN_MATURE_VIDEOS` is used; none clearing it
 * is `insufficient_cohort`, never a further, unlisted widening.
 */
export const BENCHMARK_RELAXATION: readonly BenchmarkRelaxationStep[] = [
  { windowMonths: BENCHMARK_WINDOW_MONTHS, language: 'same', relaxedAxes: [] },
  {
    windowMonths: BENCHMARK_WINDOW_MONTHS * 2,
    language: 'same',
    relaxedAxes: ['window'],
  },
  {
    windowMonths: BENCHMARK_WINDOW_MONTHS * 2,
    language: 'any',
    relaxedAxes: ['window', 'language'],
  },
];

/**
 * The peer set's identity. `connectionId` and `formatFamily` are required
 * and are not in `RelaxableAxis`, so a cohort without them does not
 * compile and no relaxation step can remove them.
 */
export interface BenchmarkCohortScope {
  accountId: string;
  connectionId: string;
  formatFamily: FormatFamily;
  /** Omitted only when the language axis has been relaxed. */
  language?: string;
}

/**
 * How far back each platform serves a post's views, from the capability
 * matrix (FILM-1703) where the platform is in it. X is (FILM-1727): its
 * posts lookup serves 30 days from post creation ("The 30-day wall" — the
 * pay-per-use path; the Enterprise window is undocumented, FILM-1725).
 * Facebook's is the capability reference's
 * (`docs/platform-capability-reference.md`): two years at request time
 * (summary table).
 */
export const VIEWS_DATA_WINDOWS: Readonly<Record<PlatformId, DataWindow>> = {
  youtube: capabilityFor('engagement', 'youtube').window,
  tiktok: capabilityFor('engagement', 'tiktok').window,
  instagram: capabilityFor('engagement', 'instagram').window,
  facebook: { maxAgeDays: 730, anchoredOn: 'request_date' },
  twitter: capabilityFor('engagement', 'twitter').window,
};

/** `video_dim.platform` as a registry platform; X is `twitter` in both. */
export function platformIdOfDim(platform: string): PlatformId | null {
  if (Object.hasOwn(VIEWS_DATA_WINDOWS, platform))
    return platform as PlatformId;

  return null;
}

/** Whether a platform can ever serve a checkpoint, before any one video is asked about. */
export type CheckpointCapability =
  | { days: number; judgable: true; window: DataWindow }
  | {
      days: number;
      judgable: false;
      /**
       * `outside_platform_window`: a publish-anchored window ends before the
       * checkpoint, so the figure is never served. `platform_stops_updating`:
       * the figure is served but stopped moving earlier, so it is not the
       * checkpoint's figure. Different facts; neither is an absent number.
       */
      reason: 'outside_platform_window' | 'platform_stops_updating';
      window: DataWindow;
    };

/**
 * The checkpoints a platform can honour, as a capability rather than a
 * global constant: X on its pay-per-use path can only ever be judged at 30
 * days.
 *
 * Only a **publish**-anchored window cuts a checkpoint here. A window
 * anchored on job creation or the request date bounds what could be
 * fetched at onboarding, not what a post has — onboarding sooner recovers
 * it — so it surfaces per video, as `predates_ingest`.
 */
export function benchmarkCheckpointsFor(
  platform: PlatformId,
  checkpoints: readonly number[] = BENCHMARK_CHECKPOINTS,
): CheckpointCapability[] {
  const window = VIEWS_DATA_WINDOWS[platform];

  return checkpoints.map((days) => checkpointCapability(window, days));
}

/** One checkpoint against one data window — the rule `benchmarkCheckpointsFor` applies. */
export function checkpointCapability(
  window: DataWindow,
  days: number,
): CheckpointCapability {
  if (
    window.anchoredOn === 'publish_date' &&
    window.maxAgeDays !== null &&
    window.maxAgeDays !== 'undocumented' &&
    days > window.maxAgeDays
  ) {
    return { days, judgable: false, reason: 'outside_platform_window', window };
  }

  if (
    window.stopsUpdatingAfterDays !== undefined &&
    days > window.stopsUpdatingAfterDays
  ) {
    return { days, judgable: false, reason: 'platform_stops_updating', window };
  }

  return { days, judgable: true, window };
}

/** Why a checkpoint cannot be judged for this video. Each is a sentence, not a zero. */
export type NotJudgableReason =
  | {
      kind: 'too_young';
      ageDays: number;
      /** The first UTC date the checkpoint is judgable on. */
      judgableOn: string;
    }
  | {
      kind: 'outside_platform_window' | 'platform_stops_updating';
      window: DataWindow;
    }
  | {
      /**
       * The checkpoint's whole window closed before the channel's first
       * ingested day. `window.anchoredOn` says whether onboarding sooner
       * would have recovered it (`job_creation`, `request_date`) or not.
       */
      kind: 'predates_ingest';
      ingestLagDays: number;
      window: DataWindow;
    }
  /** The channel has no ingested day at all: nothing is known, not zero. */
  | { kind: 'nothing_ingested' }
  /** The range crosses a view-definition change with no stored continuous series. */
  | { kind: 'view_definition_changed'; changedOn: string }
  | { kind: 'no_single_view_definition' }
  | { kind: 'not_defined_for_whole_range'; definedFrom: string };

/** One checkpoint's subject side: the figure, or why there is none. */
export type CheckpointJudgement =
  | { judgable: true; value: number }
  | { judgable: false; reason: NotJudgableReason };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseUtc(value: string): Date {
  const raw = value.trim().replace(' ', 'T');

  return new Date(/([Zz]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
}

/**
 * Whether the subject video's checkpoint may be compared at all, before its
 * value is read.
 *
 * The same rules the cohort query applies to every peer, from the same
 * functions: `computeMaturity` for age and `checkpointPredatesIngest` over
 * the channel's ingest start for ingest lag. If the two halves judged
 * eligibility differently the video would be compared against a peer set
 * built on other rules, and nothing in the output would say so.
 */
export function judgeSubjectCheckpoint(input: {
  platform: PlatformId;
  publishedAt: string;
  checkpointDays: number;
  asOf: Date;
  /** The channel's first ingested metric day (`YYYY-MM-DD`), or null. */
  channelIngestStart: string | null;
}): { judgable: true } | { judgable: false; reason: NotJudgableReason } {
  const { platform, publishedAt, checkpointDays, asOf } = input;
  const capability = benchmarkCheckpointsFor(platform, [checkpointDays])[0]!;

  if (!capability.judgable) {
    return {
      judgable: false,
      reason: { kind: capability.reason, window: capability.window },
    };
  }

  const published = parseUtc(publishedAt);

  if (!computeMaturity(published, [checkpointDays], asOf)[checkpointDays]) {
    const judgableOn = new Date(
      Date.UTC(
        published.getUTCFullYear(),
        published.getUTCMonth(),
        published.getUTCDate(),
      ) +
        checkpointDays * MS_PER_DAY,
    );

    return {
      judgable: false,
      reason: {
        kind: 'too_young',
        ageDays: calendarDaysBetween(published, asOf),
        judgableOn: utcDate(judgableOn),
      },
    };
  }

  const ingestLagDays = computeIngestLagDays(
    published,
    input.channelIngestStart,
  );

  if (ingestLagDays === null) {
    return { judgable: false, reason: { kind: 'nothing_ingested' } };
  }

  if (checkpointPredatesIngest(ingestLagDays, checkpointDays)) {
    return {
      judgable: false,
      reason: {
        kind: 'predates_ingest',
        ingestLagDays,
        window: capability.window,
      },
    };
  }

  return { judgable: true };
}

/** The view format the registry needs for a family: Shorts are their own series on YouTube. */
export function viewFormatOf(family: FormatFamily): ViewFormat {
  return family === 'short_vertical' ? 'shorts' : 'other';
}

/**
 * The dates a benchmark's views span: the earliest peer's publication
 * through the last day in the subject's own checkpoint window. Peers are
 * published before the subject, so their windows end inside this range.
 */
export function benchmarkRange(
  publishedAt: string,
  windowMonths: number,
  checkpointDays: number,
): { from: string; to: string; publishedFrom: string } {
  const published = parseUtc(publishedAt);
  const start = new Date(published);
  start.setUTCMonth(start.getUTCMonth() - windowMonths);

  const lastDay = new Date(
    Date.UTC(
      published.getUTCFullYear(),
      published.getUTCMonth(),
      published.getUTCDate(),
    ) +
      (checkpointDays - 1) * MS_PER_DAY,
  );

  return {
    from: utcDate(start),
    to: utcDate(lastDay),
    publishedFrom: start.toISOString().slice(0, 19).replace('T', ' '),
  };
}

/**
 * How far back the peers were actually drawn from. `months` is below
 * `defaultMonths` only when `narrowed` says why, so a card can say
 * "compared with 15 months, not 24" rather than lying by omission.
 */
export interface PeerWindow {
  months: number;
  /** The step's own length: 24, or 48 once the window has been widened. */
  defaultMonths: number;
  narrowed: {
    reason: 'view_definition_changed';
    /** The change the full window would have crossed. */
    changedOn: string;
    /** Where the continuous series — and so the window — begins. */
    continuousFrom: string;
  } | null;
}

/** Whole calendar months from `from` to `to`, counting a month once its day is reached. */
function wholeMonthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());

  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

/**
 * One relaxation step's dates and the views series they may be read from —
 * the one place a step's window meets the view-definition registry.
 *
 * When the full window crosses a view-definition change and the platform's
 * continuous series (YouTube's engaged views) begins inside it, the window
 * starts where that series begins instead of the benchmark being withheld
 * (owner decision, 2026-10-01), and `window.narrowed` says so. A range no
 * continuous series covers at all is still suppressed.
 */
export function benchmarkStepSeries(input: {
  platform: PlatformId;
  family: FormatFamily;
  publishedAt: string;
  step: BenchmarkRelaxationStep;
  checkpointDays: number;
}): {
  range: ReturnType<typeof benchmarkRange>;
  denominator: ViewsDenominator;
  window: PeerWindow;
} {
  const format = viewFormatOf(input.family);
  const range = benchmarkRange(
    input.publishedAt,
    input.step.windowMonths,
    input.checkpointDays,
  );
  const denominator = viewsDenominatorFor(
    input.platform,
    range.from,
    range.to,
    {
      format,
    },
  );
  const full: PeerWindow = {
    months: input.step.windowMonths,
    defaultMonths: input.step.windowMonths,
    narrowed: null,
  };

  if (
    denominator.kind !== 'suppressed' ||
    denominator.reason !== 'view_definition_changed'
  ) {
    return { range, denominator, window: full };
  }

  const continuousFrom =
    denominator.continuousAlternative?.definition.effectiveFrom ?? null;
  const published = parseUtc(input.publishedAt);

  // Only a series that begins inside the window and before the video: one
  // starting earlier would already have covered it, and one starting after
  // the video leaves no peer to compare with.
  if (
    continuousFrom === null ||
    continuousFrom <= range.from ||
    continuousFrom >= utcDate(published)
  ) {
    return { range, denominator, window: full };
  }

  const narrowedRange = {
    from: continuousFrom,
    to: range.to,
    publishedFrom: `${continuousFrom} 00:00:00`,
  };
  const narrowedDenominator = viewsDenominatorFor(
    input.platform,
    narrowedRange.from,
    narrowedRange.to,
    { format },
  );

  if (narrowedDenominator.kind !== 'column') {
    return { range, denominator, window: full };
  }

  return {
    range: narrowedRange,
    denominator: narrowedDenominator,
    window: {
      months: wholeMonthsBetween(
        new Date(`${continuousFrom}T00:00:00Z`),
        published,
      ),
      defaultMonths: input.step.windowMonths,
      narrowed: {
        reason: 'view_definition_changed',
        changedOn: denominator.changedOn,
        continuousFrom,
      },
    },
  };
}

/** A denominator the registry refused, as a not-judgable reason. */
export function viewsDenominatorReason(
  denominator: ViewsDenominator,
): NotJudgableReason | null {
  if (denominator.kind === 'column') return null;

  switch (denominator.reason) {
    case 'view_definition_changed':
      return {
        kind: 'view_definition_changed',
        changedOn: denominator.changedOn,
      };
    case 'no_single_view_definition':
      return { kind: 'no_single_view_definition' };
    case 'not_defined_for_whole_range':
      return {
        kind: 'not_defined_for_whole_range',
        definedFrom: denominator.definedFrom,
      };
  }
}

export type BenchmarkBand = 'below' | 'typical' | 'above';

/**
 * The peer distribution at one checkpoint, as `queryCohortMedians` returns
 * it. `n` is the mature, ingest-covered peer count — never the uploaded
 * count, which would be a three-video sample wearing a forty-video label.
 */
export interface CohortQuantiles {
  p25: number;
  median: number;
  p75: number;
  n: number;
}

/**
 * Below p25, above p75, typical between them inclusive: the interquartile
 * band, so a value on a quartile is not claimed by either end.
 */
export function bandFor(value: number, cohort: CohortQuantiles): BenchmarkBand {
  if (value < cohort.p25) return 'below';
  if (value > cohort.p75) return 'above';

  return 'typical';
}

/**
 * Peers at which a lift keeps half its distance from 1x. The tier at which
 * FILM-1606 calls a sample reportable, so "half-trusted" means the same
 * sample size on both scales.
 */
export const SHRINKAGE_PRIOR_PEERS = CONFIDENCE_REPORTABLE_MIN;

/**
 * Shrinks an observed lift toward 1x by the peer count: `1 + (lift − 1) ·
 * n / (n + SHRINKAGE_PRIOR_PEERS)`. Two videos at 2.8x adjust to 1.21x; a
 * hundred at 1.35x to 1.30x — so the small cohort cannot outrank the large
 * one, which a naive lift lets it do.
 */
export function shrinkLift(observedLift: number, n: number): number {
  if (n <= 0) return 1;

  return 1 + (observedLift - 1) * (n / (n + SHRINKAGE_PRIOR_PEERS));
}

interface BenchmarkBase {
  checkpointDays: number;
}

/** A reportable comparison. Band, lift, cohort median and n always travel together. */
export interface BenchmarkComparison extends BenchmarkBase {
  value: number;
  band: BenchmarkBand;
  /** `value / cohortMedian`: a descriptive ratio, not a significance claim. */
  observedLift: number;
  /** `observedLift` shrunk by `n` — what is shown and ranked; the raw stays. */
  adjustedLift: number;
  cohortMedian: number;
  cohortP25: number;
  cohortP75: number;
  n: number;
  confidence: Exclude<SegmentConfidence, 'insufficient'>;
  relaxedAxes: readonly RelaxableAxis[];
  /** The publish window peers came from; null when the caller has none. */
  peerWindow: PeerWindow | null;
}

/**
 * Four states that must never render alike. A band exists only on the two
 * judged variants, so no bar can be painted for a video that could not be
 * judged or for a peer set too thin to judge against — "we cannot judge
 * this" never looks like "this did badly".
 */
export type CheckpointBenchmark =
  | (BenchmarkBase & {
      state: 'not_judgable';
      reason: NotJudgableReason;
    })
  | (BenchmarkBase & {
      state: 'insufficient_cohort';
      /** The video's own figure: a statement about the video, kept. */
      value: number;
      /** A statement about the peer set, not the video. */
      reason: 'too_few_peers' | 'zero_baseline';
      n: number;
      minPeers: number;
      relaxedAxes: readonly RelaxableAxis[];
      peerWindow: PeerWindow | null;
    })
  | (BenchmarkComparison & { state: 'directional' })
  | (BenchmarkComparison & { state: 'established' });

export type BenchmarkState = CheckpointBenchmark['state'];

/**
 * The join: one video's checkpoint against its cohort at the same age.
 *
 * Generic over the figure — views here, any FILM-1714 signal value for
 * FILM-1718 — so long as `value` and `cohort` are the same measure at the
 * same checkpoint.
 *
 * `MIN_MATURE_VIDEOS` is the suppression gate (below it, no band at all);
 * `resolveConfidence` (FILM-1606) is the rendering tier above it. They are
 * the same number, imported from one place.
 */
export function benchmarkVideoAgainstCohort(input: {
  checkpointDays: number;
  subject: CheckpointJudgement;
  cohort: CohortQuantiles;
  relaxedAxes?: readonly RelaxableAxis[];
  peerWindow?: PeerWindow | null;
}): CheckpointBenchmark {
  const { checkpointDays, subject, cohort } = input;
  const relaxedAxes = input.relaxedAxes ?? [];
  const peerWindow = input.peerWindow ?? null;

  if (!subject.judgable) {
    return { state: 'not_judgable', checkpointDays, reason: subject.reason };
  }

  const confidence = resolveConfidence(cohort.n);

  if (confidence === 'insufficient' || cohort.median <= 0) {
    return {
      state: 'insufficient_cohort',
      checkpointDays,
      value: subject.value,
      reason: confidence === 'insufficient' ? 'too_few_peers' : 'zero_baseline',
      n: cohort.n,
      minPeers: MIN_MATURE_VIDEOS,
      relaxedAxes,
      peerWindow,
    };
  }

  const observedLift = subject.value / cohort.median;
  const comparison: BenchmarkComparison = {
    checkpointDays,
    value: subject.value,
    band: bandFor(subject.value, cohort),
    observedLift,
    adjustedLift: shrinkLift(observedLift, cohort.n),
    cohortMedian: cohort.median,
    cohortP25: cohort.p25,
    cohortP75: cohort.p75,
    n: cohort.n,
    confidence,
    relaxedAxes,
    peerWindow,
  };

  return confidence === 'reportable'
    ? { ...comparison, state: 'established' }
    : { ...comparison, state: 'directional' };
}

/** One relaxation step's peer set, or null when the step could not be used. */
export interface RelaxationAttempt {
  step: BenchmarkRelaxationStep;
  cohort: CohortQuantiles | null;
  column: ViewsColumn;
  /** The window this step actually used; absent means the step's default. */
  window?: PeerWindow;
}

/**
 * The first step whose peer set clears `MIN_MATURE_VIDEOS`, else the widest
 * step that could be used — reported with its `relaxedAxes` so the card
 * says "across all languages" rather than lying by omission. Null when no
 * step could be used at all.
 */
export function chooseRelaxation(
  attempts: readonly RelaxationAttempt[],
): (RelaxationAttempt & { cohort: CohortQuantiles }) | null {
  let widest: (RelaxationAttempt & { cohort: CohortQuantiles }) | null = null;

  for (const attempt of attempts) {
    if (!attempt.cohort) continue;

    const usable = { ...attempt, cohort: attempt.cohort };
    if (attempt.cohort.n >= MIN_MATURE_VIDEOS) return usable;

    widest = usable;
  }

  return widest;
}

/**
 * What a list ranks benchmarks by: the adjusted lift, and nothing for a
 * state with no comparison — so an unjudged or thinly-peered video sorts
 * after every judged one rather than among them.
 */
export function rankingLift(benchmark: CheckpointBenchmark): number | null {
  return benchmark.state === 'directional' || benchmark.state === 'established'
    ? benchmark.adjustedLift
    : null;
}

/** A checkpoint's benchmark, with the views series it was computed on (null when none was). */
export type VideoCheckpointBenchmark = CheckpointBenchmark & {
  viewsColumn: ViewsColumn | null;
};

/** A video's benchmark at every checkpoint, or why it has none. */
export type VideoBenchmark =
  | {
      ok: true;
      videoId: string;
      connectionId: string;
      platform: PlatformId;
      formatFamily: FormatFamily;
      /** The video's language; null when nobody set one. */
      language: string | null;
      publishedAt: string;
      asOf: string;
      checkpoints: VideoCheckpointBenchmark[];
    }
  | {
      ok: false;
      videoId: string;
      reason: 'video_not_found' | 'unsupported_platform' | 'unmapped_format';
    };
