/**
 * Signal Surfaces (FILM-1719): one video's funnel, as a creator reads it.
 *
 * Everything here renders a fact a spec below already produces. The stage
 * readings are FILM-1714's, each figure is FILM-1717's stage-aware segment
 * measure, the comparison is FILM-1715's `benchmarkVideoAgainstCohort`, the
 * diagnosis FILM-1718's `diagnoseStages`. Nothing is computed that those do
 * not compute; this module only decides which state a stage is in and keeps
 * the five kinds of emptiness apart.
 *
 * Pure and client-safe.
 */
import type {
  AnalyticsPlatform,
  BenchmarkComparison,
  CausalBacking,
  FormatFamily,
  FunnelStage,
  GenomeAttribute,
  GenomeFinding,
  MetricProvenance,
  NotJudgableReason,
  RelaxableAxis,
  SegmentMeasure,
  SignalId,
  StageDiagnosis,
  StageJudgement,
  StageJudgements,
  StageReading,
} from '@kit/clickhouse';
import {
  BENCHMARK_WINDOW_MONTHS,
  CLAIM_WORDING,
  FUNNEL_STAGE_LABEL,
  MIN_MATURE_VIDEOS,
  SIGNALS,
  benchmarkVideoAgainstCohort,
  diagnoseStages,
  quantileExactInclusive,
  stageMeasureFor,
} from '@kit/clickhouse';

// ---------------------------------------------------------------------------
// One stage
// ---------------------------------------------------------------------------

/** A peer or the subject: one video's figure for a stage's measure. */
export interface StageVideoFigure {
  videoId: string;
  publishedAt: string;
  formatFamily: FormatFamily | null;
  /** Null when the platform reported none of the measure's inputs. */
  value: number | null;
}

/** A video named on the surface: the subject, a peer or a comparable. */
export interface SurfaceVideo {
  title: string | null;
  /** The video on its platform, when the publish recorded one. */
  url: string | null;
}

/** A peer as the raw depth lists it. */
export interface StagePeer {
  videoId: string;
  publishedAt: string;
  value: number;
}

interface MeasuredBase {
  stage: FunnelStage;
  signal: SegmentMeasure;
  supporting: readonly SignalId[];
  checkpointDays: number;
  provenance: MetricProvenance;
}

/**
 * The five states FILM-1719 keeps apart. `judged` carries a band, which may
 * be below, typical or above; it is the only state with a bar.
 */
export type StageSurface =
  | {
      stage: FunnelStage;
      state: 'unbound';
      /** FILM-1714's sentence: why the platform has no such figure. */
      note: string;
    }
  | {
      stage: FunnelStage;
      state: 'dark';
      signal: SignalId;
      supporting: readonly SignalId[];
      /**
       * `not_ingested`: the inputs are not collected (FILM-1714's blockers).
       * `no_checkpoint_measure`: they are, but no reading of this signal per
       * video at a checkpoint exists yet — our gap, so dark, not unbound.
       */
      gap: 'not_ingested' | 'no_checkpoint_measure';
      blockers: readonly string[];
    }
  | (MeasuredBase & {
      state: 'not_judgable';
      /** The video's own figure, when the platform reported one. */
      value: number | null;
      why: NotJudgableWhy;
    })
  | (MeasuredBase & {
      state: 'insufficient_cohort';
      value: number;
      reason: 'too_few_peers' | 'zero_baseline';
      n: number;
      minPeers: number;
      relaxedAxes: readonly RelaxableAxis[];
      peers: readonly StagePeer[];
    })
  | (MeasuredBase & {
      state: 'judged';
      benchmark: BenchmarkComparison & {
        state: 'directional' | 'established';
      };
      peers: readonly StagePeer[];
    });

export type StageState = StageSurface['state'];

/** Why a measured stage was not compared: FILM-1715's reason, or no figure. */
export type NotJudgableWhy =
  | { kind: 'checkpoint'; reason: NotJudgableReason }
  | { kind: 'no_figure' };

/** The subject's side at a checkpoint, as FILM-1715 judged it for views. */
export type SubjectCheckpoint =
  | { judgable: true }
  | { judgable: false; reason: NotJudgableReason };

function parseUtc(value: string): number {
  return Date.parse(
    value.includes('T') ? value : `${value.replace(' ', 'T')}Z`,
  );
}

function monthsBefore(publishedAt: string, months: number): number {
  const start = new Date(parseUtc(publishedAt));
  start.setUTCMonth(start.getUTCMonth() - months);

  return start.getTime();
}

/**
 * The peer windows, in order: FILM-1715's 24 months, then its widened 48.
 * Language is not a column of the segment rows, so it is never held — and
 * every comparison says so through `relaxedAxes`, rather than implying a
 * same-language cohort it did not have.
 */
const PEER_WINDOWS = [BENCHMARK_WINDOW_MONTHS, BENCHMARK_WINDOW_MONTHS * 2];

/**
 * The subject's peers for one stage: the same channel (the rows are one
 * channel's) and format family, published before it and inside the window.
 * The rows are already mature at the checkpoint and ingest-covered; the
 * segment query decides that, as it does for the genome.
 */
export function stagePeers(
  rows: readonly StageVideoFigure[],
  subject: { videoId: string; publishedAt: string; formatFamily: FormatFamily },
  windowMonths: number,
): StagePeer[] {
  const publishedAt = parseUtc(subject.publishedAt);
  const from = monthsBefore(subject.publishedAt, windowMonths);

  return rows.flatMap((row) => {
    if (row.videoId === subject.videoId) return [];
    if (row.formatFamily !== subject.formatFamily) return [];
    if (row.value === null) return [];

    const published = parseUtc(row.publishedAt);
    if (!(published < publishedAt && published >= from)) return [];

    return [
      { videoId: row.videoId, publishedAt: row.publishedAt, value: row.value },
    ];
  });
}

function cohortOf(peers: readonly StagePeer[]) {
  const values = peers.map((peer) => peer.value);

  return values.length === 0
    ? { p25: 0, median: 0, p75: 0, n: 0 }
    : {
        p25: quantileExactInclusive(values, 0.25),
        median: quantileExactInclusive(values, 0.5),
        p75: quantileExactInclusive(values, 0.75),
        n: values.length,
      };
}

/**
 * One stage of one video at one checkpoint.
 *
 * `rows` are the segment query's figures for the stage's measure across the
 * subject's channel; they are read only for a stage `stageMeasureFor`
 * accepts, and ignored otherwise.
 */
export function stageSurfaceFor(input: {
  reading: StageReading;
  platform: AnalyticsPlatform;
  subject: {
    videoId: string;
    publishedAt: string;
    formatFamily: FormatFamily;
    checkpoint: SubjectCheckpoint;
  };
  checkpointDays: number;
  rows: readonly StageVideoFigure[];
  provenanceFor: (signal: SegmentMeasure) => MetricProvenance;
}): StageSurface {
  const { reading, platform, subject, checkpointDays, rows } = input;

  if (reading.status === 'unbound') {
    return { stage: reading.stage, state: 'unbound', note: reading.note };
  }

  const supporting = reading.supporting.map((support) => support.signal);

  if (reading.status === 'dark') {
    return {
      stage: reading.stage,
      state: 'dark',
      signal: reading.primary.signal,
      supporting,
      gap: 'not_ingested',
      blockers: reading.blockers,
    };
  }

  const measure = stageMeasureFor({
    platform,
    formatFamily: subject.formatFamily,
    stage: reading.stage,
  });

  if (!measure.ok) {
    return {
      stage: reading.stage,
      state: 'dark',
      signal: reading.primary.signal,
      supporting,
      gap: 'no_checkpoint_measure',
      blockers: [
        `No per-video reading of ${signalName(reading.primary.signal)} at a checkpoint yet`,
      ],
    };
  }

  const base: MeasuredBase = {
    stage: reading.stage,
    signal: measure.signal,
    supporting,
    checkpointDays,
    provenance: input.provenanceFor(measure.signal),
  };
  const own = rows.find((row) => row.videoId === subject.videoId);
  const value = own?.value ?? null;

  if (!subject.checkpoint.judgable) {
    return {
      ...base,
      state: 'not_judgable',
      value,
      why: { kind: 'checkpoint', reason: subject.checkpoint.reason },
    };
  }

  if (value === null) {
    return {
      ...base,
      state: 'not_judgable',
      value,
      why: { kind: 'no_figure' },
    };
  }

  let peers: StagePeer[] = [];
  let widened = false;

  for (const [index, months] of PEER_WINDOWS.entries()) {
    peers = stagePeers(rows, subject, months);
    widened = index > 0;
    if (peers.length >= MIN_MATURE_VIDEOS) break;
  }

  const relaxedAxes: RelaxableAxis[] = widened
    ? ['window', 'language']
    : ['language'];

  const benchmark = benchmarkVideoAgainstCohort({
    checkpointDays,
    subject: { judgable: true, value },
    cohort: cohortOf(peers),
    relaxedAxes,
  });

  switch (benchmark.state) {
    case 'not_judgable':
      return {
        ...base,
        state: 'not_judgable',
        value,
        why: { kind: 'checkpoint', reason: benchmark.reason },
      };
    case 'insufficient_cohort':
      return {
        ...base,
        state: 'insufficient_cohort',
        value: benchmark.value,
        reason: benchmark.reason,
        n: benchmark.n,
        minPeers: benchmark.minPeers,
        relaxedAxes: benchmark.relaxedAxes,
        peers,
      };
    case 'directional':
    case 'established':
      return { ...base, state: 'judged', benchmark, peers };
  }
}

/** What FILM-1718 reads from a stage: a band, or the reason there is none. */
export function judgementOf(surface: StageSurface): StageJudgement {
  switch (surface.state) {
    case 'unbound':
    case 'dark':
    case 'not_judgable':
    case 'insufficient_cohort':
      return { judged: false, exclusion: surface.state };
    case 'judged':
      return {
        judged: true,
        band: surface.benchmark.band,
        state: surface.benchmark.state,
      };
  }
}

/** The diagnosis over every stage, read from the same surfaces the strip draws. */
export function diagnosisOf(
  surfaces: Readonly<Record<FunnelStage, StageSurface>>,
): StageDiagnosis {
  const judgements = Object.fromEntries(
    Object.entries(surfaces).map(([stage, surface]) => [
      stage,
      judgementOf(surface),
    ]),
  ) as StageJudgements;

  return diagnoseStages(judgements);
}

// ---------------------------------------------------------------------------
// Words and figures
// ---------------------------------------------------------------------------

/** A creator-facing name for a signal. */
const SIGNAL_NAME: Partial<Record<SignalId, string>> = {
  impressions: 'impressions',
  impressions_ctr: 'impressions click-through rate',
  average_view_duration: 'average view duration',
  share_rate: 'shares per view',
  comment_rate: 'comments per view',
  subscriber_conversion: 'subscribers per view',
};

export function signalName(signal: SignalId): string {
  return SIGNAL_NAME[signal] ?? signal.replaceAll('_', ' ');
}

export function signalDefinition(signal: SignalId): string {
  return SIGNALS[signal].definition;
}

/**
 * One figure in its own unit. The rates are fractions (the segment query
 * divides two counts), so they read as a percentage; duration is seconds.
 */
export function formatSignalValue(
  signal: SegmentMeasure,
  value: number,
): string {
  switch (signal) {
    case 'impressions':
      return Math.round(value).toLocaleString('en-US');
    case 'average_view_duration': {
      const total = Math.round(value);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    }
    case 'impressions_ctr':
    case 'share_rate':
    case 'comment_rate':
    case 'subscriber_conversion': {
      const percent = value * 100;
      return `${percent < 1 ? percent.toFixed(2) : percent.toFixed(1)}%`;
    }
  }
}

/** One decimal, or two where one would round a lift to exactly 1.0x. */
export function formatLift(lift: number): string {
  const short = lift.toFixed(1);

  return `${short === '1.0' && lift !== 1 ? lift.toFixed(2) : short}x`;
}

/**
 * The drill-down's line, which carries value, lift, typical and n together:
 * "4.2% shares per view · 1.8x typical · typical = 2.3% · n = 83".
 */
export function measureLine(
  signal: SegmentMeasure,
  benchmark: Pick<
    BenchmarkComparison,
    'value' | 'adjustedLift' | 'cohortMedian' | 'n'
  >,
): string {
  return [
    `${formatSignalValue(signal, benchmark.value)} ${signalName(signal)}`,
    `${formatLift(benchmark.adjustedLift)} typical`,
    `typical = ${formatSignalValue(signal, benchmark.cohortMedian)}`,
    `n = ${benchmark.n}`,
  ].join(' · ');
}

export const BAND_LABEL = {
  below: 'Below',
  typical: 'Typical',
  above: 'Above',
} as const;

/** What a not-judgable stage says beside its figure. */
export function notJudgableSentence(why: NotJudgableWhy): string {
  if (why.kind === 'no_figure') {
    return 'The platform reported no figure for this video at this checkpoint.';
  }

  const reason = why.reason;

  switch (reason.kind) {
    case 'too_young':
      return `Too new to compare: ${reason.ageDays} days old, comparable from ${reason.judgableOn}.`;
    case 'outside_platform_window':
      return 'Too old to compare: this checkpoint is outside the platform’s data window.';
    case 'platform_stops_updating':
      return 'The platform stops updating this figure before this age.';
    case 'predates_ingest':
      return `This checkpoint closed before analytics collection began (${reason.ingestLagDays} days after publishing).`;
    case 'nothing_ingested':
      return 'Nothing has been collected for this channel yet.';
    case 'view_definition_changed':
      return `View counting changed on ${reason.changedOn}, so this window has no single definition.`;
    case 'no_single_view_definition':
      return 'This window has no single view definition.';
    case 'not_defined_for_whole_range':
      return `This figure is defined only from ${reason.definedFrom}.`;
  }
}

export function relaxedAxesSentence(
  axes: readonly RelaxableAxis[],
): string | null {
  const parts = [
    ...(axes.includes('window')
      ? [`window widened to ${BENCHMARK_WINDOW_MONTHS * 2} months`]
      : []),
    ...(axes.includes('language') ? ['across all languages'] : []),
  ];

  return parts.length === 0 ? null : parts.join(', ');
}

/** Peers in the comparison, said as a peer count, never as a band. */
export function insufficientSentence(
  surface: Extract<StageSurface, { state: 'insufficient_cohort' }>,
): string {
  return surface.reason === 'zero_baseline'
    ? `Not compared: the ${surface.n} comparable videos have a typical figure of zero.`
    : `Not compared: ${surface.n} comparable video${surface.n === 1 ? '' : 's'}, ${surface.minPeers} needed.`;
}

export function publishedDay(value: string): string {
  return new Date(parseUtc(value)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Genome claims
// ---------------------------------------------------------------------------

export function attributeName(attribute: GenomeAttribute): string {
  return `${attribute.dimension.replaceAll('_', ' ')}: ${attribute.value}`;
}

/** Which kind of test backs a causal claim, and when it concluded. */
export function backingSentence(backing: CausalBacking): string {
  return backing.kind === 'change_log'
    ? `concluded Change log entry, ${publishedDay(backing.concludedOn)}`
    : `concluded channel experiment “${backing.title}”, ${publishedDay(backing.endedAt)}`;
}

/**
 * FILM-1717's wording for each claim strength, filled in. The three read
 * differently on purpose: "had … typical" is a cross-tab, "is associated
 * with" held the comparables fixed, and "Changing to … increased" is said
 * only with the concluded test that showed it, named in the sentence.
 */
export function claimSentence(finding: GenomeFinding): string {
  const { evidence } = finding;
  const fill: Record<string, string> = {
    attribute: attributeName(finding.attribute),
    lift: formatLift(evidence.adjustedLift),
    stage: FUNNEL_STAGE_LABEL[evidence.stage].toLowerCase(),
    direction: finding.direction === 'higher' ? 'increased' : 'decreased',
    backing:
      evidence.claim.strength === 'causal'
        ? backingSentence(evidence.claim.backing)
        : '',
  };

  return CLAIM_WORDING[evidence.claim.strength].replace(
    /\{(\w+)\}/g,
    (_, key: string) => fill[key] ?? '',
  );
}

export const CLAIM_STRENGTH_LABEL: Record<
  GenomeFinding['evidence']['claim']['strength'],
  string
> = {
  observed: 'Observed',
  controlled_association: 'Controlled association',
  causal: 'Causal',
};
