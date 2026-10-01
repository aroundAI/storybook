/**
 * The genome's closed loop (FILM-1717 v2).
 *
 * ```
 * genome hypothesis → experiment → outcome → causal evidence
 *     → genome confidence update
 * ```
 *
 * A finding generates a hypothesis; a Change log entry (FILM-1610) or a
 * channel experiment (FILM-1724) records which hypothesis it tests
 * (`analytics_experiments.genome_hypothesis`); once that test concludes, its
 * outcome updates the finding. Only a confirmed, uncontested test makes a
 * claim causal — the one path to that strength — and the claim names the
 * test and its kind. A rejected test keeps the finding visible and says so.
 *
 * Pure and client-safe.
 */
import type { GenomeAnalysis } from './genome';
import type { GenomeAttribute } from './genome-attributes';
import type { CausalBacking, Evidence, GenomeFinding } from './genome-evidence';
import { evidenceLabel, rankingDistance } from './genome-evidence';
import type { FunnelStage } from './signal-map';
import { FUNNEL_STAGES, FUNNEL_STAGE_LABEL } from './signal-map';

/**
 * `dimension:slug@stage` — the hypothesis's identity, stored on the
 * experiment that tests it. The table's CHECK is this pattern;
 * genome-loop.test.ts compares the two.
 */
export const GENOME_HYPOTHESIS_PATTERN = new RegExp(
  `^[a-z0-9_]+:[a-z0-9]+(-[a-z0-9]+)*@(${FUNNEL_STAGES.join('|')})$`,
);

declare const hypothesisKey: unique symbol;

export type GenomeHypothesisKey = string & { readonly [hypothesisKey]: true };

export function genomeHypothesisKey(
  attribute: Pick<GenomeAttribute, 'tag'>,
  stage: FunnelStage,
): GenomeHypothesisKey {
  return `${attribute.tag}@${stage}` as GenomeHypothesisKey;
}

/** Null for anything that is not a well-formed key. */
export function parseGenomeHypothesisKey(
  value: string | null,
): GenomeHypothesisKey | null {
  return value !== null && GENOME_HYPOTHESIS_PATTERN.test(value)
    ? (value as GenomeHypothesisKey)
    : null;
}

/**
 * A finding restated as something to test. Every genome attribute is part of
 * the video itself, so a Change log entry — which compares the same published
 * videos before and after a change — cannot test one; a channel experiment,
 * comparing new uploads made each way, can.
 */
export interface GenomeHypothesis {
  key: GenomeHypothesisKey;
  attribute: GenomeAttribute;
  stage: FunnelStage;
  direction: GenomeFinding['direction'];
  statement: string;
  testWith: 'channel_experiment';
  /** The observational evidence that generated it. */
  evidence: Evidence;
}

function attributeName(attribute: GenomeAttribute): string {
  return `${attribute.dimension.replaceAll('_', ' ')}: ${attribute.value}`;
}

/**
 * One hypothesis per finding that is not already causal. Strongest first, as
 * the findings are ranked.
 */
export function hypothesesFrom(analysis: GenomeAnalysis): GenomeHypothesis[] {
  return analysis.findings
    .filter((finding) => finding.evidence.claim.strength !== 'causal')
    .map((finding) => {
      const verb = finding.direction === 'higher' ? 'raises' : 'lowers';

      return {
        key: genomeHypothesisKey(finding.attribute, analysis.stage),
        attribute: finding.attribute,
        stage: analysis.stage,
        direction: finding.direction,
        statement: `Using ${attributeName(finding.attribute)} ${verb} ${FUNNEL_STAGE_LABEL[analysis.stage]} (${evidenceLabel(finding.evidence)})`,
        testWith: 'channel_experiment',
        evidence: finding.evidence,
      };
    });
}

/** A concluded test, and the hypothesis it was linked to. */
export interface LinkedTest {
  hypothesis: GenomeHypothesisKey;
  backing: CausalBacking;
}

/**
 * Each finding with the concluded tests of its hypothesis applied.
 *
 * - confirmed, and no test rejected it → `causal`, naming the confirming
 *   test (the most recent) and its kind;
 * - rejected by any test → stays observational, `testedBy` says so;
 * - inconclusive → stays observational, `testedBy` says so.
 *
 * Contested results never upgrade a claim: one confirmation does not cancel
 * a rejection.
 */
export function applyLinkedTests(
  analysis: GenomeAnalysis,
  tests: readonly LinkedTest[],
): GenomeAnalysis {
  const update = (finding: GenomeFinding): GenomeFinding => {
    const key = genomeHypothesisKey(finding.attribute, analysis.stage);
    const testedBy = tests
      .filter((test) => test.hypothesis === key)
      .map((test) => test.backing)
      .sort((a, b) => b.concludedOn.localeCompare(a.concludedOn));

    if (testedBy.length === 0) return finding;

    const rejected = testedBy.some((backing) => backing.outcome === 'rejected');
    const confirmed = testedBy.find(
      (backing) => backing.outcome === 'confirmed',
    );

    return {
      ...finding,
      testedBy,
      evidence:
        confirmed && !rejected
          ? {
              ...finding.evidence,
              claim: { strength: 'causal', backing: confirmed },
            }
          : finding.evidence,
    };
  };

  return {
    ...analysis,
    findings: analysis.findings.map(update),
    strata: analysis.strata.map((stratum) => ({
      ...stratum,
      findings: stratum.findings.map(update),
    })),
  };
}

// ---------------------------------------------------------------------------
// Creative templates
// ---------------------------------------------------------------------------

/** The part of a template each mechanism plays. */
export type TemplateRole = 'hook' | 'body' | 'payoff' | 'emotion' | 'length';

const HOOK_DIMENSIONS = new Set([
  'hook_type',
  'opening_visual',
  'first_sentence',
  'question_first_3s',
  'face_present',
]);

export function templateRole(attribute: GenomeAttribute): TemplateRole {
  if (attribute.layer === 'semantic') return 'emotion';
  if (attribute.dimension === 'duration') return 'length';
  if (attribute.dimension === 'result_first') return 'payoff';
  if (HOOK_DIMENSIONS.has(attribute.dimension)) return 'hook';

  return 'body';
}

export interface TemplateMechanism {
  attribute: GenomeAttribute;
  role: TemplateRole;
  stage: FunnelStage;
  evidence: Evidence;
}

/**
 * A winning pattern generalised: the mechanisms that succeeded together on
 * the same videos. Non-empty by type — a template with no evidence behind it
 * does not compile, for the reason a recommendation does not.
 */
export interface CreativeTemplate {
  id: string;
  mechanisms: readonly [TemplateMechanism, ...TemplateMechanism[]];
  /** Stages its mechanisms were found on, in funnel order. */
  strongestStages: readonly FunnelStage[];
  /** The successful videos every mechanism here shares. */
  exemplars: readonly string[];
}

function successfulIds(evidence: Evidence): Set<string> {
  return new Set(evidence.successful.map((video) => video.videoId));
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((id) => b.has(id)));
}

/**
 * Templates from positive findings across one or more stages' analyses.
 *
 * Seeded by each positive finding in rank order, then grown with any other
 * dimension's positive finding whose successful videos overlap the template's
 * — so every mechanism in a template was on the same winning videos, not
 * merely each a winner somewhere. A seed already inside a template does not
 * start another.
 */
export function deriveTemplates(
  analyses: readonly GenomeAnalysis[],
): CreativeTemplate[] {
  const positives = analyses
    .flatMap((analysis) =>
      analysis.findings
        .filter((finding) => finding.direction === 'higher')
        .map((finding) => ({
          attribute: finding.attribute,
          role: templateRole(finding.attribute),
          stage: analysis.stage,
          evidence: finding.evidence,
        })),
    )
    // Rank order across analyses: strongest adjusted lift first.
    .sort(
      (a, b) =>
        rankingDistance(b.evidence) - rankingDistance(a.evidence) ||
        a.attribute.tag.localeCompare(b.attribute.tag),
    );

  const used = new Set<string>();
  const templates: CreativeTemplate[] = [];

  for (const seed of positives) {
    if (used.has(seed.attribute.tag)) continue;

    const mechanisms: TemplateMechanism[] = [seed];
    let exemplars = successfulIds(seed.evidence);

    for (const candidate of positives) {
      if (
        mechanisms.some(
          (mechanism) =>
            mechanism.attribute.dimension === candidate.attribute.dimension,
        )
      ) {
        continue;
      }

      const shared = intersect(exemplars, successfulIds(candidate.evidence));
      if (shared.size === 0) continue;

      mechanisms.push(candidate);
      exemplars = shared;
    }

    for (const mechanism of mechanisms) used.add(mechanism.attribute.tag);

    templates.push({
      id: mechanisms
        .map((mechanism) => mechanism.attribute.tag)
        .sort()
        .join('+'),
      mechanisms: [seed, ...mechanisms.slice(1)],
      strongestStages: FUNNEL_STAGES.filter((stage) =>
        mechanisms.some((mechanism) => mechanism.stage === stage),
      ),
      exemplars: [...exemplars].sort(),
    });
  }

  return templates;
}

/** A new concept that keeps a template's mechanisms and changes its subject. */
export interface ConceptBrief {
  subject: string;
  templateId: string;
  /** One line per mechanism, in the order a video plays them. */
  steps: readonly string[];
  /** The tags a video made from this brief should carry. */
  tags: readonly string[];
  mechanisms: CreativeTemplate['mechanisms'];
}

const ROLE_ORDER: Record<TemplateRole, number> = {
  hook: 0,
  body: 1,
  payoff: 2,
  emotion: 3,
  length: 4,
};

const ROLE_VERB: Record<TemplateRole, string> = {
  hook: 'Open with',
  body: 'Carry the middle with',
  payoff: 'Pay off with',
  emotion: 'Play on',
  length: 'Keep it',
};

export function instantiateTemplate(
  template: CreativeTemplate,
  subject: string,
): ConceptBrief {
  const ordered = [...template.mechanisms].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );

  return {
    subject,
    templateId: template.id,
    steps: ordered.map(
      (mechanism) =>
        `${ROLE_VERB[mechanism.role]} ${attributeName(mechanism.attribute)} — about ${subject} (${evidenceLabel(mechanism.evidence)})`,
    ),
    tags: ordered
      .filter((mechanism) => mechanism.attribute.source === 'tag')
      .map((mechanism) => mechanism.attribute.tag),
    mechanisms: template.mechanisms,
  };
}
