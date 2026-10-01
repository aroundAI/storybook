/**
 * Stage diagnosis (FILM-1718): which part of the funnel is the constraint,
 * read from the stage bands together.
 *
 * Five bands read together answer a question a composite score of the same
 * five numbers cannot: where to look. So this layer never adds bands up. It
 * matches them against a closed, ordered list of patterns, and the first
 * row that matches wins.
 *
 * Three rules hold the layer honest:
 *
 * - **Judged stages only.** A stage that is unbound, dark, `not_judgable`
 *   or `insufficient_cohort` has no band. It is excluded from the pattern
 *   and counted by its reason, so "we cannot say" never reads as "below".
 * - **Bands, never figures.** A `StageJudgement` carries no number, so no
 *   absolute threshold can be applied here. Every figure is already
 *   relative to the channel's own cohort (FILM-1715). FILM-1616's breakage
 *   flags keep their absolute thresholds, in their own table.
 * - **Measurement, not cause.** Each sentence says what was measured and
 *   where to look. Why it happened belongs to FILM-1717; a causal claim
 *   belongs only to a concluded Change log entry or experiment.
 *
 * Depends on FILM-1714 and FILM-1715 and on nothing else, deliberately not
 * the content genome, so the diagnosis works from day one.
 *
 * Pure and client-safe, like the rest of `lib/`.
 */
import type { AnalyticsPlatform } from '../types';
import type { BenchmarkBand, CheckpointBenchmark } from './self-benchmark';
import { FUNNEL_STAGES, FUNNEL_STAGE_LABEL, stageReadings } from './signal-map';
import type { FunnelStage, PublishFormat, StageReading } from './signal-map';

// ---------------------------------------------------------------------------
// One stage, judged or not
// ---------------------------------------------------------------------------

/**
 * Why a stage has no band, in the order a creator can do something about
 * it: never (unbound), by a ticket (dark), by waiting (not_judgable), by
 * publishing more (insufficient_cohort).
 */
export const STAGE_EXCLUSIONS = [
  'unbound',
  'dark',
  'not_judgable',
  'insufficient_cohort',
] as const;

export type StageExclusion = (typeof STAGE_EXCLUSIONS)[number];

const EXCLUSION_PHRASE: Record<StageExclusion, string> = {
  unbound: 'the platform does not report it',
  dark: 'not collected yet',
  not_judgable: 'not comparable at this checkpoint',
  insufficient_cohort: 'too few comparable videos',
};

/** One stage as the diagnosis sees it: a band, or why there is none. No figure. */
export type StageJudgement =
  | {
      judged: true;
      band: BenchmarkBand;
      state: 'directional' | 'established';
    }
  | { judged: false; exclusion: StageExclusion };

/** Every stage, by type: a sixth stage stops a caller compiling until it is judged. */
export type StageJudgements = Readonly<Record<FunnelStage, StageJudgement>>;

/**
 * A FILM-1714 reading and, for a measurable stage only, its FILM-1715
 * benchmark. `benchmarkFor` is not called for an unbound or dark stage:
 * there is no figure to benchmark.
 */
export function judgeStage(
  reading: StageReading,
  benchmarkFor: (stage: FunnelStage) => CheckpointBenchmark,
): StageJudgement {
  if (reading.status !== 'measurable') {
    return { judged: false, exclusion: reading.status };
  }

  const benchmark = benchmarkFor(reading.stage);

  switch (benchmark.state) {
    case 'not_judgable':
    case 'insufficient_cohort':
      return { judged: false, exclusion: benchmark.state };
    case 'directional':
    case 'established':
      return { judged: true, band: benchmark.band, state: benchmark.state };
  }
}

/** Every stage of one platform × format, in funnel order. */
export function judgeStages(
  platform: AnalyticsPlatform,
  format: PublishFormat,
  benchmarkFor: (stage: FunnelStage) => CheckpointBenchmark,
): StageJudgements {
  // `stageReadings` iterates FUNNEL_STAGES, so the record is total.
  return Object.fromEntries(
    stageReadings(platform, format).map((reading) => [
      reading.stage,
      judgeStage(reading, benchmarkFor),
    ]),
  ) as StageJudgements;
}

// ---------------------------------------------------------------------------
// The patterns
// ---------------------------------------------------------------------------

/**
 * What a row needs from one stage.
 *
 * - `above` / `below`: the row names this stage. It must be judged, in
 *   this band.
 * - `above_where_judged` / `below_where_judged`: "the others". A judged
 *   stage must be in this band; an unjudged one is no objection, because
 *   it is excluded, not weak.
 * - `any`: the row says nothing about this stage.
 *
 * `typical` satisfies none of the first four. The rows speak only of above
 * and below, so a typical stage is neither strong nor weak, and treating
 * it as either would put a video in the nearest row instead of no row.
 */
export type StageRequirement =
  | 'above'
  | 'below'
  | 'above_where_judged'
  | 'below_where_judged'
  | 'any';

export interface StagePattern {
  id: string;
  /**
   * A requirement for every stage, spelled out. When FILM-1726 appends
   * `monetisation` to `FUNNEL_STAGES`, every row stops compiling until
   * someone decides what it asks of the new stage. A helper that filled
   * "the others" automatically would decide that silently.
   */
  requires: Readonly<Record<FunnelStage, StageRequirement>>;
  /** What was measured, and where to look. Never a cause. */
  sentence: string;
}

/**
 * The spec's table, in its precedence order: evaluated top to bottom, the
 * first match wins. A fully judged combination that matches no row is
 * `no_clear_pattern`, which is a real and common answer.
 *
 * The rows are not a partition. Over `MIN_JUDGED_STAGES` or more judged
 * stages they are also pairwise exclusive as written, so the order decides
 * nothing yet; it starts to the day a row is loosened or a stage is added,
 * and the test counting overlaps is what makes that day visible.
 */
export const STAGE_PATTERNS = [
  {
    id: 'reach_below_content_above',
    requires: {
      reach: 'below',
      hook: 'above_where_judged',
      attention: 'above_where_judged',
      transmission: 'above_where_judged',
      audience: 'above_where_judged',
    },
    sentence:
      'Content signals are strong relative to distribution — investigate packaging and distribution.',
  },
  {
    id: 'reach_above_content_below',
    requires: {
      reach: 'above',
      hook: 'below_where_judged',
      attention: 'below_where_judged',
      transmission: 'below_where_judged',
      audience: 'below_where_judged',
    },
    sentence:
      'Distribution is not the constraint; content signals are weak relative to comparable videos.',
  },
  {
    id: 'hook_above_attention_below',
    requires: {
      reach: 'any',
      hook: 'above',
      attention: 'below',
      transmission: 'any',
      audience: 'any',
    },
    sentence:
      'Openings hold; later retention is weaker than comparable videos.',
  },
  {
    id: 'attention_above_transmission_below',
    requires: {
      reach: 'any',
      hook: 'any',
      attention: 'above',
      transmission: 'below',
      audience: 'any',
    },
    sentence:
      'Attention is strong; transmission is weaker relative to comparable videos.',
  },
  {
    id: 'consumption_above_audience_below',
    requires: {
      reach: 'any',
      hook: 'any',
      attention: 'above',
      transmission: 'above',
      audience: 'below',
    },
    sentence:
      'Consumption is strong; follow conversion is weaker than comparable videos.',
  },
  {
    id: 'above_at_every_judged_stage',
    requires: {
      reach: 'above_where_judged',
      hook: 'above_where_judged',
      attention: 'above_where_judged',
      transmission: 'above_where_judged',
      audience: 'above_where_judged',
    },
    sentence: 'Strong across every judged stage relative to comparable videos.',
  },
] as const satisfies readonly StagePattern[];

export type StagePatternId = (typeof STAGE_PATTERNS)[number]['id'];

/**
 * A pattern is a relation between stages. One judged stage is a band, not
 * a pattern, and every row compares at least two, so below two the answer
 * is `too_few_judged` rather than the nearest row.
 */
export const MIN_JUDGED_STAGES = 2;

/** The first row `judgements` satisfies, in order, or null. */
export function matchPattern<P extends StagePattern>(
  judgements: StageJudgements,
  patterns: readonly P[],
): P | null {
  return (
    patterns.find((pattern) =>
      FUNNEL_STAGES.every((stage) =>
        meets(pattern.requires[stage], judgements[stage]),
      ),
    ) ?? null
  );
}

function meets(
  requirement: StageRequirement,
  judgement: StageJudgement,
): boolean {
  switch (requirement) {
    case 'any':
      return true;
    case 'above':
    case 'below':
      return judgement.judged && judgement.band === requirement;
    case 'above_where_judged':
      return !judgement.judged || judgement.band === 'above';
    case 'below_where_judged':
      return !judgement.judged || judgement.band === 'below';
  }
}

// ---------------------------------------------------------------------------
// The diagnosis
// ---------------------------------------------------------------------------

export interface JudgedStage {
  stage: FunnelStage;
  band: BenchmarkBand;
  state: 'directional' | 'established';
}

/**
 * What the diagnosis was computed from. It travels with every outcome:
 * a sentence read over two judged stages is a different claim from the
 * same sentence over five, and only the count says which.
 */
export interface StageCoverage {
  stageCount: number;
  judgedCount: number;
  /** In funnel order, each with its band. */
  judged: readonly JudgedStage[];
  /** Every unjudged stage, under its reason. */
  excluded: Readonly<Record<StageExclusion, readonly FunnelStage[]>>;
  /** Creator-facing: how many stages were judged, and why the rest were not. */
  sentence: string;
}

/**
 * Three outcomes that must never share a sentence. `no_clear_pattern` and
 * `too_few_judged` are both absent, for different reasons: the first had
 * enough stages and they agreed on nothing; the second did not have enough
 * stages to ask.
 */
export type StageDiagnosis =
  | {
      kind: 'pattern';
      pattern: StagePatternId;
      sentence: string;
      coverage: StageCoverage;
    }
  | { kind: 'no_clear_pattern'; sentence: string; coverage: StageCoverage }
  | {
      kind: 'too_few_judged';
      sentence: string;
      coverage: StageCoverage;
      minJudged: number;
    };

export const NO_CLEAR_PATTERN_SENTENCE =
  'The judged stages show no clear pattern relative to comparable videos.';

function tooFewSentence(judgedCount: number, stageCount: number): string {
  return judgedCount === 0
    ? 'No stage could be judged against comparable videos, so there is no pattern to read.'
    : `Only ${judgedCount} of ${stageCount} stages could be judged against comparable videos — too few to read a pattern across stages.`;
}

function coverageOf(judgements: StageJudgements): StageCoverage {
  const judged: JudgedStage[] = [];
  const excluded: Record<StageExclusion, FunnelStage[]> = {
    unbound: [],
    dark: [],
    not_judgable: [],
    insufficient_cohort: [],
  };
  const notJudged: string[] = [];

  for (const stage of FUNNEL_STAGES) {
    const judgement = judgements[stage];

    if (judgement.judged) {
      judged.push({ stage, band: judgement.band, state: judgement.state });
    } else {
      excluded[judgement.exclusion].push(stage);
      notJudged.push(
        `${FUNNEL_STAGE_LABEL[stage]} (${EXCLUSION_PHRASE[judgement.exclusion]})`,
      );
    }
  }

  const stageCount = FUNNEL_STAGES.length;
  const sentence =
    notJudged.length === 0
      ? `Judged on all ${stageCount} stages.`
      : `Judged on ${judged.length} of ${stageCount} stages. Not judged: ${notJudged.join(', ')}.`;

  return {
    stageCount,
    judgedCount: judged.length,
    judged,
    excluded,
    sentence,
  };
}

/**
 * The diagnosis for one video on one platform at one checkpoint. Every
 * judgement must come from the same platform and checkpoint: a pattern is
 * computed within one platform, because its inputs are.
 */
export function diagnoseStages(judgements: StageJudgements): StageDiagnosis {
  const coverage = coverageOf(judgements);

  if (coverage.judgedCount < MIN_JUDGED_STAGES) {
    return {
      kind: 'too_few_judged',
      sentence: tooFewSentence(coverage.judgedCount, coverage.stageCount),
      coverage,
      minJudged: MIN_JUDGED_STAGES,
    };
  }

  const pattern = matchPattern(judgements, STAGE_PATTERNS);

  if (!pattern) {
    return {
      kind: 'no_clear_pattern',
      sentence: NO_CLEAR_PATTERN_SENTENCE,
      coverage,
    };
  }

  return {
    kind: 'pattern',
    pattern: pattern.id,
    sentence: pattern.sentence,
    coverage,
  };
}
