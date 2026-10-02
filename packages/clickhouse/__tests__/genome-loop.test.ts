import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ChannelExperimentResults } from '../src/lib/channel-experiments';
import { toConcludedChannelExperiment } from '../src/lib/channel-experiments';
import type { GenomeAnalysis, GenomeVideo } from '../src/lib/genome';
import { analyseGenome } from '../src/lib/genome';
import { parseVideoTag } from '../src/lib/genome-attributes';
import type { CausalBacking } from '../src/lib/genome-evidence';
import { concludedChangeLogEntry } from '../src/lib/genome-evidence';
import type { CreativeTemplate } from '../src/lib/genome-loop';
import {
  GENOME_HYPOTHESIS_PATTERN,
  applyLinkedTests,
  deriveTemplates,
  genomeHypothesisKey,
  hypothesesFrom,
  instantiateTemplate,
  parseGenomeHypothesisKey,
  templateRole,
} from '../src/lib/genome-loop';
import { metricProvenanceFor } from '../src/lib/genome-measures';
import type { FunnelStage } from '../src/lib/signal-map';

const REPO = resolve(import.meta.dirname, '../../..');
const CHANNEL = 'c0000000-0000-4000-8000-000000000001';

function video(id: string, value: number, tags: string[]): GenomeVideo {
  return {
    videoId: id,
    connectionId: CHANNEL,
    platform: 'youtube',
    formatFamily: 'long_horizontal',
    assetDurationSeconds: 300,
    tags,
    value,
  };
}

/**
 * Twenty videos valued 1..20, median 10.5. identity:high on 15..20 and 1;
 * hook_type:cold-open on 13..20 and 2; text_present:yes on 11..14 and 3 —
 * a winner too, but on different winning videos from identity's.
 */
function library(): GenomeVideo[] {
  return Array.from({ length: 20 }, (_, index) => {
    const value = index + 1;
    return video(`v${value}`, value, [
      value >= 15 || value === 1 ? 'identity:high' : 'identity:low',
      value >= 13 || value === 2 ? 'hook_type:cold-open' : 'hook_type:other',
      (value >= 11 && value <= 14) || value === 3
        ? 'text_present:yes'
        : 'text_present:no',
    ]);
  });
}

function analyse(stage: FunnelStage = 'transmission'): GenomeAnalysis {
  return analyseGenome({
    videos: library(),
    stage,
    signal: stage === 'hook' ? 'impressions_ctr' : 'share_rate',
    checkpointDays: 30,
    control: 'observed',
    provenance: metricProvenanceFor(
      stage === 'hook' ? 'impressions_ctr' : 'share_rate',
      'youtube',
    ),
  });
}

/**
 * A concluded channel experiment (FILM-1724), built the only way one is:
 * from its record. `separated` decides whether its two styles' ranges
 * cleared each other at 30 days.
 */
function channelExperiment(
  id: string,
  outcome: string,
  separated: boolean,
): CausalBacking {
  const style = (styleId: string, median: number) => ({
    styleId,
    name: styleId,
    measured: 6,
    pending: 0,
    notMeasurable: 0,
    distribution: { p25: median - 1, median, p75: median + 1 },
    confidence: 'directional' as const,
  });
  const results: ChannelExperimentResults = {
    version: 1,
    asOf: '2026-09-10T00:00:00.000Z',
    results: [
      {
        measure: 'views',
        checkpointDays: 30,
        styles: [style('cold-open', 50), style('slow-open', 10)],
        verdict: {
          kind: 'compared',
          threshold: 5,
          pairs: [
            {
              styleId: 'cold-open',
              otherStyleId: 'slow-open',
              relation: separated ? 'ahead' : 'no_clear_difference',
            },
            {
              styleId: 'slow-open',
              otherStyleId: 'cold-open',
              relation: separated ? 'behind' : 'no_clear_difference',
            },
          ],
          anyClearDifference: separated,
        },
      },
    ],
  };

  return toConcludedChannelExperiment({
    id,
    account_id: 'a1',
    connection_id: CHANNEL,
    format_family: 'long_horizontal',
    title: 'Hooks',
    hypothesis: null,
    expected_outcome: null,
    status: 'concluded',
    started_at: '2026-07-01',
    ended_at: '2026-09-10',
    conclusion: 'Cold opens win',
    outcome_status: outcome,
    result_snapshot: results,
    styles: [],
  })!;
}

function changeLog(
  id: string,
  outcome: string,
  endedAt = '2026-09-01',
): CausalBacking {
  return concludedChangeLogEntry({
    id,
    status: 'concluded',
    ended_at: endedAt,
    outcome_status: outcome,
  })!;
}

describe('semantic attributes (layer B)', () => {
  it('parse as genome attributes of the semantic layer, with fixed levels', () => {
    expect(parseVideoTag('identity:high')).toMatchObject({
      kind: 'genome',
      layer: 'semantic',
      dimension: 'identity',
    });
    expect(parseVideoTag('identity:very-high')).toBeNull();
  });
});

describe('hypotheses', () => {
  it('are keyed dimension:slug@stage, and the table accepts exactly that form', () => {
    const migrations = readdirSync(join(REPO, 'apps/web/supabase/migrations'))
      .sort()
      .reverse();
    const sql = migrations
      .map((name) =>
        readFileSync(join(REPO, 'apps/web/supabase/migrations', name), 'utf8'),
      )
      .find((text) =>
        text.includes('analytics_experiments_genome_hypothesis_check'),
      )!;
    const pattern = /genome_hypothesis ~ '([^']+)'/.exec(sql)![1]!;

    // The same pattern, `monetisation` included: FILM-1726 appended it to
    // FUNNEL_STAGES, and the TypeScript pattern derives from that list.
    expect(pattern).toBe(GENOME_HYPOTHESIS_PATTERN.source);
    expect(GENOME_HYPOTHESIS_PATTERN.test('utility:high@monetisation')).toBe(
      true,
    );

    for (const hypothesis of hypothesesFrom(analyse())) {
      expect(new RegExp(pattern).test(hypothesis.key)).toBe(true);
    }
    expect(parseGenomeHypothesisKey('identity:high@transmission')).toBe(
      'identity:high@transmission',
    );
    expect(parseGenomeHypothesisKey('identity:high@views')).toBeNull();
    expect(parseGenomeHypothesisKey('Identity:High@hook')).toBeNull();
  });

  it('restate each finding as something a channel experiment can test', () => {
    const [first] = hypothesesFrom(analyse());

    expect(first).toMatchObject({
      key: 'identity:high@transmission',
      direction: 'higher',
      testWith: 'channel_experiment',
    });
    expect(first!.statement).toMatch(
      /^Using identity: high raises Transmission \(/,
    );
    expect(first!.evidence.claim.strength).toBe('observed');
  });
});

describe('the confidence update from concluded tests', () => {
  const key = genomeHypothesisKey({ tag: 'identity:high' }, 'transmission');
  const identity = (analysis: GenomeAnalysis) =>
    analysis.findings.find(
      (finding) => finding.attribute.tag === 'identity:high',
    )!;

  it('makes a claim causal only from a confirmed test, and names its kind', () => {
    const updated = applyLinkedTests(analyse(), [
      { hypothesis: key, backing: changeLog('e1', 'confirmed') },
    ]);
    const claim = identity(updated).evidence.claim;

    expect(claim.strength).toBe('causal');
    expect(claim).toMatchObject({
      strength: 'causal',
      backing: { kind: 'change_log', id: 'e1' },
    });
    expect(hypothesesFrom(updated).map((h) => h.key)).not.toContain(key);
  });

  it('accepts a concluded channel experiment (FILM-1724) whose styles separated, by its kind', () => {
    const finding = identity(
      applyLinkedTests(analyse(), [
        {
          hypothesis: key,
          backing: channelExperiment('x1', 'confirmed', true),
        },
      ]),
    );

    expect(finding.evidence.claim).toMatchObject({
      strength: 'causal',
      backing: { kind: 'concluded_channel_experiment', experimentId: 'x1' },
    });
    expect(finding.testedBy).toMatchObject([
      {
        kind: 'concluded_channel_experiment',
        id: 'x1',
        concludedOn: '2026-09-10',
        outcome: 'confirmed',
      },
    ]);
  });

  it('does not treat a confirmed channel experiment whose styles never separated as causal', () => {
    const finding = identity(
      applyLinkedTests(analyse(), [
        {
          hypothesis: key,
          backing: channelExperiment('x2', 'confirmed', false),
        },
      ]),
    );

    // experimentFindings finds no non-overlapping pair: whatever the owner
    // concluded, the experiment showed no clear difference.
    expect(finding.evidence.claim.strength).toBe('observed');
    expect(finding.testedBy).toMatchObject([
      { id: 'x2', outcome: 'inconclusive' },
    ]);
  });

  it('keeps a rejected finding observational, and says it was tested', () => {
    const finding = identity(
      applyLinkedTests(analyse(), [
        { hypothesis: key, backing: changeLog('e2', 'rejected') },
      ]),
    );

    expect(finding.evidence.claim.strength).toBe('observed');
    expect(finding.testedBy.map((test) => [test.id, test.outcome])).toEqual([
      ['e2', 'rejected'],
    ]);
  });

  it('does not let a confirmation cancel a rejection', () => {
    const finding = identity(
      applyLinkedTests(analyse(), [
        {
          hypothesis: key,
          backing: changeLog('e1', 'confirmed', '2026-09-20'),
        },
        { hypothesis: key, backing: changeLog('e2', 'rejected', '2026-09-01') },
      ]),
    );

    expect(finding.evidence.claim.strength).toBe('observed');
    expect(finding.testedBy.map((test) => test.id)).toEqual(['e1', 'e2']);
  });

  it('leaves an inconclusive test, or one of another hypothesis, without effect on the claim', () => {
    const analysis = applyLinkedTests(analyse(), [
      { hypothesis: key, backing: changeLog('e3', 'inconclusive') },
      {
        hypothesis: genomeHypothesisKey({ tag: 'identity:high' }, 'hook'),
        backing: changeLog('e4', 'confirmed'),
      },
    ]);

    expect(identity(analysis).evidence.claim.strength).toBe('observed');
    expect(identity(analysis).testedBy.map((test) => test.id)).toEqual(['e3']);
  });
});

describe('creative templates', () => {
  it('group the mechanisms that won together on the same videos', () => {
    const templates = deriveTemplates([analyse()]);
    const template = templates.find((entry) =>
      entry.mechanisms.some((m) => m.attribute.tag === 'identity:high'),
    )!;

    // identity:high wins on 15..20; cold-open on 13..20: shared 15..20.
    expect(template.id).toBe('hook_type:cold-open+identity:high');
    expect(template.mechanisms.map((m) => m.role).sort()).toEqual([
      'emotion',
      'hook',
    ]);
    expect(template.exemplars).toEqual([
      'v15',
      'v16',
      'v17',
      'v18',
      'v19',
      'v20',
    ]);
    expect(template.strongestStages).toEqual(['transmission']);

    // text_present:yes won on 11..14, none of which identity won on, so it
    // is not a third mechanism of this template. It won beside cold-open on
    // 13 and 14: that is a template of its own.
    expect(templates.map((entry) => [entry.id, entry.exemplars])).toEqual([
      ['hook_type:cold-open+identity:high', template.exemplars],
      ['hook_type:cold-open+text_present:yes', ['v13', 'v14']],
    ]);
  });

  it('instantiate a new subject with the same mechanisms', () => {
    const [template] = deriveTemplates([analyse()]);
    const brief = instantiateTemplate(template!, 'sourdough starters');

    expect(brief.subject).toBe('sourdough starters');
    expect(brief.tags).toEqual(['hook_type:cold-open', 'identity:high']);
    expect(brief.steps[0]).toMatch(
      /^Open with hook type: cold-open — about sourdough starters/,
    );
    expect(brief.steps[1]).toMatch(/^Play on identity: high/);
  });

  it('name each mechanism’s role', () => {
    expect(templateRole(parseVideoTag('result_first:yes') as never)).toBe(
      'payoff',
    );
    expect(
      templateRole(parseVideoTag('cuts_per_minute:over-30') as never),
    ).toBe('body');
  });

  it('do not compile without evidence behind a mechanism', () => {
    const empty: CreativeTemplate = {
      id: 'x',
      // @ts-expect-error — a template has at least one mechanism
      mechanisms: [],
      strongestStages: [],
      exemplars: [],
    };
    const [template] = deriveTemplates([analyse()]);
    const { evidence: _dropped, ...mechanism } = template!.mechanisms[0];
    const bare: CreativeTemplate = {
      ...template!,
      // @ts-expect-error — each mechanism carries its evidence
      mechanisms: [mechanism],
    };

    expect([empty, bare]).toHaveLength(2);
  });
});
