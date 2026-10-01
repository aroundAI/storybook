/**
 * Evidence, claim strength and recommendations (FILM-1717).
 *
 * The genome produces sentences that sound authoritative about creative
 * decisions, from small samples, on observational data. Everything here
 * exists so that it cannot overclaim by construction:
 *
 * - a claim's strength is a type, and `causal` takes a reference to a
 *   concluded Change log entry (FILM-1610) or a concluded channel experiment
 *   (FILM-1724), branded so only the guards below can produce one;
 * - every claim carries an `Evidence`, which carries both comparable sets,
 *   both lifts and a `MetricProvenance`;
 * - a `Recommendation` has no constructor but `recommendFrom`, which takes a
 *   finding, which always has its evidence.
 *
 * Pure and client-safe.
 */
import type { DurationBand, GenomeAttribute } from './genome-attributes';
import type { MetricProvenance, SegmentMeasure } from './genome-measures';
import type { SegmentConfidence } from './segment-stats';
import { SHRINKAGE_PRIOR_PEERS, shrinkLift } from './self-benchmark';
import type { FunnelStage } from './signal-map';

// ---------------------------------------------------------------------------
// Evidence levels: FILM-1606's tiers, surfaced as evidence rather than a gate
// ---------------------------------------------------------------------------

export type EvidenceLevel = 'observation' | 'directional' | 'established';

/**
 * FILM-1606's confidence tiers, renamed for a creator and never re-counted:
 * `resolveConfidence` decides, this only names. An `insufficient` segment is
 * still shown — as an early signal — because silence below the top tier is
 * what makes a back-catalog feature useless for seven months.
 */
export const EVIDENCE_LEVEL_BY_CONFIDENCE: Record<
  SegmentConfidence,
  EvidenceLevel
> = {
  insufficient: 'observation',
  directional: 'directional',
  reportable: 'established',
};

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceLevel, string> = {
  observation: 'Early signal',
  directional: 'Directional',
  established: 'Established pattern',
};

// ---------------------------------------------------------------------------
// What backs a causal claim
// ---------------------------------------------------------------------------

declare const concluded: unique symbol;

/**
 * A Change log entry (FILM-1610, `analytics_experiments`) that has concluded.
 * Compares the same published videos before and after a change.
 *
 * Branded: only `concludedChangeLogEntry` returns one, and it returns null
 * for an entry that has not concluded.
 */
export interface ConcludedChangeLogEntry {
  readonly kind: 'change_log';
  readonly id: string;
  readonly concludedOn: string;
  /** The owner's own reading of the result (FILM-1610 `outcome_status`). */
  readonly outcome: 'confirmed' | 'rejected' | 'inconclusive';
  readonly [concluded]: true;
}

/**
 * A channel experiment (FILM-1724, `channel_experiments`) that has concluded.
 * Compares styles across new uploads.
 *
 * FILM-1724 is not built yet. This is the seam its rows plug into: the
 * lifecycle below is the one its spec gives (§3, "planned → running →
 * concluded or abandoned"), and nothing in this repository can produce one
 * until that table exists.
 */
export interface ConcludedChannelExperiment {
  readonly kind: 'channel_experiment';
  readonly id: string;
  readonly concludedOn: string;
  readonly outcome: 'confirmed' | 'rejected' | 'inconclusive';
  readonly [concluded]: true;
}

/** Names which kind backs the claim: they answer different questions. */
export type CausalBacking =
  | ConcludedChangeLogEntry
  | ConcludedChannelExperiment;

export type ExperimentOutcome = 'pending' | ConcludedChangeLogEntry['outcome'];

/** The columns of an `analytics_experiments` row this reads. */
export interface ChangeLogRow {
  id: string;
  status: string;
  ended_at: string | null;
  outcome_status: string;
}

/** The columns a `channel_experiments` row will have (FILM-1724 §3). */
export interface ChannelExperimentRow {
  id: string;
  status: 'planned' | 'running' | 'concluded' | 'abandoned';
  ended_at: string | null;
  outcome_status: ExperimentOutcome;
}

function concludedOutcome(
  status: string,
  endedAt: string | null,
  outcome: string,
): ConcludedChangeLogEntry['outcome'] | null {
  if (status !== 'concluded' || !endedAt) return null;
  if (
    outcome !== 'confirmed' &&
    outcome !== 'rejected' &&
    outcome !== 'inconclusive'
  ) {
    return null;
  }

  return outcome;
}

export function concludedChangeLogEntry(
  row: ChangeLogRow,
): ConcludedChangeLogEntry | null {
  const outcome = concludedOutcome(
    row.status,
    row.ended_at,
    row.outcome_status,
  );
  if (!outcome || !row.ended_at) return null;

  return {
    kind: 'change_log',
    id: row.id,
    concludedOn: row.ended_at,
    outcome,
  } as ConcludedChangeLogEntry;
}

export function concludedChannelExperiment(
  row: ChannelExperimentRow,
): ConcludedChannelExperiment | null {
  const outcome = concludedOutcome(
    row.status,
    row.ended_at,
    row.outcome_status,
  );
  if (!outcome || !row.ended_at) return null;

  return {
    kind: 'channel_experiment',
    id: row.id,
    concludedOn: row.ended_at,
    outcome,
  } as ConcludedChannelExperiment;
}

// ---------------------------------------------------------------------------
// Claim strength
// ---------------------------------------------------------------------------

/**
 * What "comparable" meant for this claim. Platform, format family and
 * creator (the channel) are always fixed — the genome never compares across
 * them. Duration band and topic are fixed only for a controlled association.
 */
export interface ComparableDefinition {
  connectionId: string;
  platform: string;
  formatFamily: string;
  /** Null when the comparison was not held to one band. */
  durationBand: DurationBand | null;
  /** Null when the comparison was not held to one topic. */
  topic: string | null;
  checkpointDays: number;
}

export type ControlledComparable = ComparableDefinition & {
  durationBand: DurationBand;
  topic: string;
};

/**
 * - `observed`: a cross-tab within one channel and format family.
 * - `controlled_association`: among videos of the same platform, format
 *   family, duration band, topic and creator, one attribute varying.
 * - `causal`: only from a concluded Change log entry or channel experiment,
 *   which the claim names.
 */
export type ClaimStrength =
  | { strength: 'observed' }
  | { strength: 'controlled_association'; controls: ControlledComparable }
  | { strength: 'causal'; backing: CausalBacking };

export const CLAIM_WORDING: Record<ClaimStrength['strength'], string> = {
  observed: 'Videos tagged {attribute} had {lift} typical {stage}',
  controlled_association:
    'Among comparable videos, {attribute} is associated with {lift} {stage}',
  causal: 'Changing to {attribute} {direction} {stage} ({backing})',
};

// ---------------------------------------------------------------------------
// The Evidence object
// ---------------------------------------------------------------------------

/** One video in a comparable set, with the figure it was judged on. */
export interface ComparableVideo {
  videoId: string;
  value: number;
}

/** A row the figures were computed from. */
export interface EvidenceSourceRow {
  videoId: string;
  value: number;
  hasAttribute: boolean;
}

export interface Evidence {
  level: EvidenceLevel;
  /** Measured videos with the attribute. */
  n: number;
  /** Measured videos in the comparable set, with or without it. */
  cohortN: number;
  comparable: ComparableDefinition;
  claim: ClaimStrength;
  stage: FunnelStage;
  signal: SegmentMeasure;
  /** The cohort's median: what "typical" means for this claim. */
  typical: number;
  /** The median among videos with the attribute. */
  attributeMedian: number;
  /** `attributeMedian / typical`: descriptive, not a significance claim. */
  observedLift: number;
  /** `observedLift` shrunk toward 1x by n — what is shown and ranked. */
  adjustedLift: number;
  /** `n / (n + SHRINKAGE_PRIOR_PEERS)`: how much of the distance from 1x survives. */
  shrinkageFactor: number;
  /** Videos with this mechanism, above the cohort median. */
  successful: readonly ComparableVideo[];
  /** Videos with this mechanism, below it. */
  unsuccessful: readonly ComparableVideo[];
  sourceRows: readonly EvidenceSourceRow[];
  provenance: MetricProvenance;
}

export function shrinkageFactor(n: number): number {
  return n <= 0 ? 0 : n / (n + SHRINKAGE_PRIOR_PEERS);
}

/** Both lifts, from the same n, so they cannot drift apart. */
export function liftPair(
  attributeMedian: number,
  typical: number,
  n: number,
): { observedLift: number; adjustedLift: number; shrinkageFactor: number } {
  const observedLift = attributeMedian / typical;

  return {
    observedLift,
    adjustedLift: shrinkLift(observedLift, n),
    shrinkageFactor: shrinkageFactor(n),
  };
}

/**
 * The order findings are ranked in: distance of the adjusted lift from 1x on
 * a log scale, so 0.5x and 2x are equally far. Never the observed lift —
 * that is how two videos at 2.8x outrank a hundred at 1.35x.
 */
export function rankingDistance(
  evidence: Pick<Evidence, 'adjustedLift'>,
): number {
  return Math.abs(Math.log(evidence.adjustedLift));
}

/** "Early signal — 7 videos · 1.21x adjusted", for a label beside a claim. */
export function evidenceLabel(
  evidence: Pick<Evidence, 'level' | 'n' | 'adjustedLift'>,
): string {
  const videos = `${evidence.n} video${evidence.n === 1 ? '' : 's'}`;

  return `${EVIDENCE_LEVEL_LABEL[evidence.level]} — ${videos} · ${evidence.adjustedLift.toFixed(2)}x adjusted`;
}

// ---------------------------------------------------------------------------
// Findings and recommendations
// ---------------------------------------------------------------------------

/** A mechanism that separates winners from comparable losers. */
export interface GenomeFinding {
  attribute: GenomeAttribute;
  /**
   * Attributes on exactly the same videos. They cannot be told apart, so
   * they are one finding, never several independent ones.
   */
  inseparableFrom: readonly GenomeAttribute[];
  direction: 'higher' | 'lower';
  /** Share of winners and of comparable losers tagged in this dimension that carry it. */
  prevalence: {
    winners: number;
    losers: number;
    winnersWith: number;
    winnersTagged: number;
    losersWith: number;
    losersTagged: number;
  };
  evidence: Evidence;
  /**
   * Concluded tests of this finding's hypothesis, newest first (v2). A
   * rejected or inconclusive test keeps the finding visible and says so;
   * only a confirmed, uncontested one makes the claim causal.
   */
  testedBy: readonly CausalBacking[];
}

declare const recommendation: unique symbol;

/**
 * What to make next, and why. The evidence is a required field and the
 * brand means `recommendFrom` is the only way to build one — so a
 * recommendation that cannot name its evidence does not compile.
 */
export interface Recommendation {
  readonly attribute: GenomeAttribute;
  readonly action: 'use_more' | 'use_less';
  readonly sentence: string;
  readonly evidence: Evidence;
  readonly [recommendation]: true;
}

export function recommendFrom(finding: GenomeFinding): Recommendation {
  const { attribute, evidence, direction } = finding;
  const action = direction === 'higher' ? 'use_more' : 'use_less';
  const verb = direction === 'higher' ? 'Try more' : 'Try less';

  return {
    attribute,
    action,
    sentence: `${verb} ${attribute.dimension.replaceAll('_', ' ')}: ${attribute.value} (${evidenceLabel(evidence)}, ${evidence.claim.strength.replaceAll('_', ' ')})`,
    evidence,
  } as Recommendation;
}
