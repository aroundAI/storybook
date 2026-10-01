import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CheckpointBenchmark } from '../src/lib/self-benchmark';
import { benchmarkVideoAgainstCohort } from '../src/lib/self-benchmark';
import type { FunnelStage } from '../src/lib/signal-map';
import { FUNNEL_STAGES, stageReadings } from '../src/lib/signal-map';
import {
  MIN_JUDGED_STAGES,
  NO_CLEAR_PATTERN_SENTENCE,
  STAGE_EXCLUSIONS,
  STAGE_PATTERNS,
  diagnoseStages,
  judgeStage,
  judgeStages,
  matchPattern,
} from '../src/lib/stage-diagnosis';
import type {
  StageDiagnosis,
  StageJudgement,
  StageJudgements,
  StagePattern,
} from '../src/lib/stage-diagnosis';

const above: StageJudgement = {
  judged: true,
  band: 'above',
  state: 'established',
};
const below: StageJudgement = {
  judged: true,
  band: 'below',
  state: 'established',
};
const typical: StageJudgement = {
  judged: true,
  band: 'typical',
  state: 'established',
};
const unbound: StageJudgement = { judged: false, exclusion: 'unbound' };
const dark: StageJudgement = { judged: false, exclusion: 'dark' };
const tooYoung: StageJudgement = { judged: false, exclusion: 'not_judgable' };
const thinCohort: StageJudgement = {
  judged: false,
  exclusion: 'insufficient_cohort',
};

/** Every stage `fill`, then the named ones overridden. */
function stages(
  fill: StageJudgement,
  named: Partial<Record<FunnelStage, StageJudgement>> = {},
): StageJudgements {
  return Object.fromEntries(
    FUNNEL_STAGES.map((stage) => [stage, named[stage] ?? fill]),
  ) as StageJudgements;
}

/** The five rows of the spec's table, in order, as the spec states them. */
const SPEC_ROWS: StageJudgements[] = [
  stages(above, { reach: below }),
  stages(below, { reach: above }),
  stages(typical, { hook: above, attention: below }),
  stages(typical, { attention: above, transmission: below }),
  stages(typical, {
    attention: above,
    transmission: above,
    audience: below,
  }),
  stages(above),
];

const OPTIONS: readonly StageJudgement[] = [
  below,
  typical,
  above,
  unbound,
  dark,
  tooYoung,
  thinCohort,
];

/** Every assignment of `options` to every stage: options.length ** stages. */
function* everyCombination(
  options: readonly StageJudgement[],
): Generator<StageJudgements> {
  const indices = FUNNEL_STAGES.map(() => 0);

  while (true) {
    yield Object.fromEntries(
      FUNNEL_STAGES.map((stage, i) => [stage, options[indices[i]!]!]),
    ) as StageJudgements;

    let position = 0;
    while (position < indices.length) {
      indices[position]! += 1;
      if (indices[position]! < options.length) break;
      indices[position] = 0;
      position += 1;
    }
    if (position === indices.length) return;
  }
}

// ---------------------------------------------------------------------------
// An oracle, written against the named stages rather than the table, so the
// table-driven implementation is checked by something that does not share
// its shape.
// ---------------------------------------------------------------------------

function bandOf(judgement: StageJudgement) {
  return judgement.judged ? judgement.band : null;
}

// Content against distribution: Monetisation is neither, so the first two
// rows ask nothing of it (FILM-1726 §11).
function othersAre(
  input: StageJudgements,
  except: FunnelStage,
  band: 'above' | 'below',
): boolean {
  const others = FUNNEL_STAGES.filter(
    (stage) => stage !== except && stage !== 'monetisation',
  );
  return others.every((stage) => {
    const b = bandOf(input[stage]);
    return b === null || b === band;
  });
}

const ORACLE: { id: string; holds: (input: StageJudgements) => boolean }[] = [
  {
    id: 'reach_below_content_above',
    holds: (s) => bandOf(s.reach) === 'below' && othersAre(s, 'reach', 'above'),
  },
  {
    id: 'reach_above_content_below',
    holds: (s) => bandOf(s.reach) === 'above' && othersAre(s, 'reach', 'below'),
  },
  {
    id: 'hook_above_attention_below',
    holds: (s) => bandOf(s.hook) === 'above' && bandOf(s.attention) === 'below',
  },
  {
    id: 'attention_above_transmission_below',
    holds: (s) =>
      bandOf(s.attention) === 'above' && bandOf(s.transmission) === 'below',
  },
  {
    id: 'consumption_above_audience_below',
    holds: (s) =>
      bandOf(s.attention) === 'above' &&
      bandOf(s.transmission) === 'above' &&
      bandOf(s.audience) === 'below',
  },
  {
    id: 'above_at_every_judged_stage',
    holds: (s) =>
      FUNNEL_STAGES.every((stage) => {
        const b = bandOf(s[stage]);
        return b === null || b === 'above';
      }),
  },
];

function judgedCountOf(input: StageJudgements): number {
  return FUNNEL_STAGES.filter((stage) => input[stage].judged).length;
}

// The minimum counts distribution and content only: a judged Monetisation
// never lifts a video out of too_few_judged (FILM-1726 §11).
function countedTowardMinimum(input: StageJudgements): number {
  return FUNNEL_STAGES.filter(
    (stage) => stage !== 'monetisation' && input[stage].judged,
  ).length;
}

function expectedKind(input: StageJudgements): string {
  if (countedTowardMinimum(input) < MIN_JUDGED_STAGES) return 'too_few_judged';

  return ORACLE.find((row) => row.holds(input))?.id ?? 'no_clear_pattern';
}

function outcomeOf(diagnosis: StageDiagnosis): string {
  return diagnosis.kind === 'pattern' ? diagnosis.pattern : diagnosis.kind;
}

// ---------------------------------------------------------------------------

describe('the pattern set', () => {
  it('is closed, named, and in the spec table’s order', () => {
    expect(STAGE_PATTERNS.map((pattern) => pattern.id)).toEqual(
      ORACLE.map((row) => row.id),
    );
  });

  it('states a requirement for every stage in every row, so a new stage is a decision', () => {
    for (const pattern of STAGE_PATTERNS) {
      expect(Object.keys(pattern.requires).sort()).toEqual(
        [...FUNNEL_STAGES].sort(),
      );
    }
  });

  it('resolves each row of the spec’s table to that row', () => {
    expect(SPEC_ROWS.map((row) => outcomeOf(diagnoseStages(row)))).toEqual(
      ORACLE.map((row) => row.id),
    );
  });

  it('has a fixed wording, so a causal edit is a visible diff', () => {
    expect(STAGE_PATTERNS.map((pattern) => [pattern.id, pattern.sentence]))
      .toMatchInlineSnapshot(`
      [
        [
          "reach_below_content_above",
          "Content signals are strong relative to distribution — investigate packaging and distribution.",
        ],
        [
          "reach_above_content_below",
          "Distribution is not the constraint; content signals are weak relative to comparable videos.",
        ],
        [
          "hook_above_attention_below",
          "Openings hold; later retention is weaker than comparable videos.",
        ],
        [
          "attention_above_transmission_below",
          "Attention is strong; transmission is weaker relative to comparable videos.",
        ],
        [
          "consumption_above_audience_below",
          "Consumption is strong; follow conversion is weaker than comparable videos.",
        ],
        [
          "above_at_every_judged_stage",
          "Strong across every judged stage relative to comparable videos.",
        ],
      ]
    `);
  });
});

describe('diagnoseStages, exhaustively', () => {
  const fullyJudged = [...everyCombination([below, typical, above])];
  const everything = [...everyCombination(OPTIONS)];

  it('covers every combination of three bands over every stage', () => {
    expect(fullyJudged).toHaveLength(3 ** FUNNEL_STAGES.length);
    expect(everything).toHaveLength(OPTIONS.length ** FUNNEL_STAGES.length);
  });

  it('resolves every combination, judged or not, to the outcome the oracle names', () => {
    const mismatches = everything.filter(
      (input) => outcomeOf(diagnoseStages(input)) !== expectedKind(input),
    );

    expect(mismatches).toEqual([]);
  });

  it('splits the fully-judged combinations into these counts', () => {
    const counts: Record<string, number> = {};
    for (const input of fullyJudged) {
      const outcome = outcomeOf(diagnoseStages(input));
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }

    expect(counts).toEqual({
      reach_below_content_above: 3,
      reach_above_content_below: 3,
      hook_above_attention_below: 81,
      attention_above_transmission_below: 81,
      consumption_above_audience_below: 27,
      above_at_every_judged_stage: 1,
      no_clear_pattern: 533,
    });
  });

  it('never contradicts the bands it reports', () => {
    for (const input of everything) {
      const diagnosis = diagnoseStages(input);
      if (diagnosis.kind !== 'pattern') continue;

      const pattern = STAGE_PATTERNS.find(
        (candidate) => candidate.id === diagnosis.pattern,
      )!;
      const reported = Object.fromEntries(
        diagnosis.coverage.judged.map((entry) => [entry.stage, entry.band]),
      ) as Partial<Record<FunnelStage, string>>;

      for (const stage of FUNNEL_STAGES) {
        const requirement = pattern.requires[stage];
        const band = reported[stage];

        if (requirement === 'above' || requirement === 'below') {
          expect(band).toBe(requirement);
        }
        if (requirement === 'above_where_judged') {
          expect([undefined, 'above']).toContain(band);
        }
        if (requirement === 'below_where_judged') {
          expect([undefined, 'below']).toContain(band);
        }
      }
    }
  });

  it('counts every stage once: judged plus each exclusion is the stage count', () => {
    for (const input of everything) {
      const { coverage } = diagnoseStages(input);
      const excluded = STAGE_EXCLUSIONS.reduce(
        (sum, exclusion) => sum + coverage.excluded[exclusion].length,
        0,
      );

      expect(coverage.judgedCount).toBe(judgedCountOf(input));
      expect(coverage.judged).toHaveLength(coverage.judgedCount);
      expect(coverage.judgedCount + excluded).toBe(FUNNEL_STAGES.length);
      expect(coverage.stageCount).toBe(FUNNEL_STAGES.length);
    }
  });
});

describe('precedence', () => {
  it('takes the first matching row when two rows match', () => {
    const loose: StagePattern = {
      id: 'loose',
      sentence: 'Loose.',
      requires: stagesOf('any'),
    };
    const strict: StagePattern = {
      id: 'strict',
      sentence: 'Strict.',
      requires: { ...stagesOf('any'), reach: 'above' },
    };
    const input = stages(above);

    expect(matchPattern(input, [strict, loose])?.id).toBe('strict');
    expect(matchPattern(input, [loose, strict])?.id).toBe('loose');
  });

  it('has no combination that reaches the table and matches two rows today', () => {
    // Over enough judged stages the rows as written are pairwise exclusive,
    // so precedence decides nothing yet. It starts deciding the day a row
    // is loosened or a stage is added; this count makes that day visible.
    // Below the minimum they do overlap (Reach above and nothing else
    // judged fits rows 2 and 6), which is one more reason one stage is
    // too_few_judged rather than a row.
    const all = [...everyCombination(OPTIONS)];
    const overlaps = (input: StageJudgements) =>
      ORACLE.filter((row) => row.holds(input)).length > 1;

    expect(
      all.filter(
        (input) =>
          countedTowardMinimum(input) >= MIN_JUDGED_STAGES && overlaps(input),
      ),
    ).toHaveLength(0);
    expect(
      all.filter(
        (input) =>
          countedTowardMinimum(input) < MIN_JUDGED_STAGES && overlaps(input),
      ).length,
    ).toBeGreaterThan(0);
  });
});

function stagesOf<T>(value: T): Record<FunnelStage, T> {
  return Object.fromEntries(
    FUNNEL_STAGES.map((stage) => [stage, value]),
  ) as Record<FunnelStage, T>;
}

describe('typical', () => {
  it('satisfies neither above nor below, in any row', () => {
    for (const [index, row] of SPEC_ROWS.entries()) {
      const pattern = STAGE_PATTERNS[index]!;

      for (const stage of FUNNEL_STAGES) {
        const requirement = pattern.requires[stage];
        if (requirement === 'any') continue;

        const withTypical = { ...row, [stage]: typical };
        expect(outcomeOf(diagnoseStages(withTypical))).not.toBe(pattern.id);
      }
    }
  });

  it('makes an all-typical video no_clear_pattern, not the nearest row', () => {
    const diagnosis = diagnoseStages(stages(typical));

    expect(diagnosis.kind).toBe('no_clear_pattern');
    expect(diagnosis.sentence).toBe(NO_CLEAR_PATTERN_SENTENCE);
    expect(diagnosis.coverage.judgedCount).toBe(FUNNEL_STAGES.length);
  });
});

describe('partial data', () => {
  it('reports how many stages a pattern was computed over', () => {
    const overTwo = diagnoseStages(stages(dark, { reach: below, hook: above }));
    const overFive = diagnoseStages(
      stages(above, { reach: below, monetisation: dark }),
    );

    expect(outcomeOf(overTwo)).toBe('reach_below_content_above');
    expect(outcomeOf(overFive)).toBe('reach_below_content_above');
    expect(overTwo.coverage.judgedCount).toBe(2);
    expect(overFive.coverage.judgedCount).toBe(5);
    expect(overTwo.coverage.sentence).not.toBe(overFive.coverage.sentence);
  });

  it('says what each unjudged stage is, by reason', () => {
    const diagnosis = diagnoseStages({
      reach: below,
      hook: unbound,
      attention: dark,
      transmission: tooYoung,
      audience: thinCohort,
      monetisation: unbound,
    });

    expect(diagnosis.coverage.excluded).toEqual({
      unbound: ['hook', 'monetisation'],
      dark: ['attention'],
      not_judgable: ['transmission'],
      insufficient_cohort: ['audience'],
    });
    expect(diagnosis.coverage.sentence).toMatchInlineSnapshot(
      `"Judged on 1 of 6 stages. Not judged: Hook (the platform does not report it), Attention (not collected yet), Transmission (not comparable at this checkpoint), Audience (too few comparable videos), Monetisation (the platform does not report it)."`,
    );
  });

  it('gives too few judged stages a named absent state, not the nearest row', () => {
    const one = diagnoseStages(stages(dark, { reach: below }));

    expect(one.kind).toBe('too_few_judged');
    expect(one.kind === 'too_few_judged' && one.minJudged).toBe(
      MIN_JUDGED_STAGES,
    );
  });

  it('never counts Monetisation toward the minimum: Reach and earnings alone are too few', () => {
    // Counted, these two reached rows 1 and 2, which then spoke of content
    // signals with no content stage judged (FILM-1726 §11).
    for (const reach of [below, typical, above]) {
      for (const monetisation of [below, typical, above]) {
        const diagnosis = diagnoseStages(
          stages(dark, { reach, monetisation }),
        );

        expect(diagnosis.kind).toBe('too_few_judged');
        expect(diagnosis.coverage.judgedCount).toBe(2);
      }
    }
  });

  it('words too few judged and no clear pattern differently', () => {
    const tooFew = diagnoseStages(stages(dark, { reach: below }));
    const noPattern = diagnoseStages(stages(typical));

    expect(tooFew.kind).not.toBe(noPattern.kind);
    expect(tooFew.sentence).not.toBe(noPattern.sentence);
  });

  it('makes an all-dark video a coverage statement, not a diagnosis', () => {
    const diagnosis = diagnoseStages(stages(dark));

    expect(diagnosis.kind).toBe('too_few_judged');
    expect(diagnosis.coverage.judgedCount).toBe(0);
    expect(diagnosis.coverage.excluded.dark).toEqual([...FUNNEL_STAGES]);
    expect([diagnosis.sentence, diagnosis.coverage.sentence])
      .toMatchInlineSnapshot(`
        [
          "No stage could be judged against comparable videos, so there is no pattern to read.",
          "Judged on 0 of 6 stages. Not judged: Reach (not collected yet), Hook (not collected yet), Attention (not collected yet), Transmission (not collected yet), Audience (not collected yet), Monetisation (not collected yet).",
        ]
      `);
  });

  it('reads a dark stage differently from a below one', () => {
    const darkReach = diagnoseStages(stages(above, { reach: dark }));
    const belowReach = diagnoseStages(stages(above, { reach: below }));

    expect(outcomeOf(darkReach)).toBe('above_at_every_judged_stage');
    expect(outcomeOf(belowReach)).toBe('reach_below_content_above');
  });
});

describe('the wording', () => {
  const CAUSAL =
    /\b(because|caus\w*|due to|reason|enjoy\w*|bored|lik(e|ed)|lov(e|ed)|want\w*|felt|feel\w*|wasn.t|worth|the limit|limiting|drove|driven)\b/i;

  it('asserts no cause and no viewer’s state of mind in any sentence', () => {
    const sentences = new Set<string>();
    for (const input of everyCombination(OPTIONS)) {
      const diagnosis = diagnoseStages(input);
      sentences.add(diagnosis.sentence);
      sentences.add(diagnosis.coverage.sentence);
    }

    const causal = [...sentences].filter((sentence) => CAUSAL.test(sentence));
    expect(causal).toEqual([]);
  });

  it('catches the wording the spec rules out', () => {
    expect(CAUSAL.test('Enjoyed but not worth passing on')).toBe(true);
    expect(CAUSAL.test('Packaging is the limit')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// From FILM-1714 readings and FILM-1715 benchmarks
// ---------------------------------------------------------------------------

const COHORT = { p25: 100, median: 200, p75: 400, n: 40 };

function benchmarked(value: number): CheckpointBenchmark {
  return benchmarkVideoAgainstCohort({
    checkpointDays: 30,
    subject: { judgable: true, value },
    cohort: COHORT,
  });
}

const NOT_JUDGABLE: CheckpointBenchmark = benchmarkVideoAgainstCohort({
  checkpointDays: 30,
  subject: {
    judgable: false,
    reason: { kind: 'too_young', ageDays: 3, judgableOn: '2026-10-28' },
  },
  cohort: COHORT,
});

const THIN: CheckpointBenchmark = benchmarkVideoAgainstCohort({
  checkpointDays: 30,
  subject: { judgable: true, value: 50 },
  cohort: { ...COHORT, n: 2 },
});

describe('judgeStage', () => {
  const [reach] = stageReadings('youtube', 'long_horizontal');

  it('carries the band of a directional or established benchmark', () => {
    expect(judgeStage(reach!, () => benchmarked(50))).toEqual({
      judged: true,
      band: 'below',
      state: 'established',
    });
  });

  it('excludes a stage FILM-1715 could not judge, by its state', () => {
    expect(judgeStage(reach!, () => NOT_JUDGABLE)).toEqual({
      judged: false,
      exclusion: 'not_judgable',
    });
    expect(judgeStage(reach!, () => THIN)).toEqual({
      judged: false,
      exclusion: 'insufficient_cohort',
    });
  });

  it('excludes an unbound or dark stage without asking for a benchmark', () => {
    // A Short has no reach figure on YouTube (FILM-1714).
    const [shortReach] = stageReadings('youtube', 'short_vertical');
    const asked: FunnelStage[] = [];

    expect(
      judgeStage(shortReach!, (stage) => {
        asked.push(stage);
        return benchmarked(500);
      }),
    ).toEqual({ judged: false, exclusion: 'unbound' });
    expect(asked).toEqual([]);
  });

  it('keeps no figure, so this layer cannot hold an absolute threshold', () => {
    const low = judgeStage(reach!, () => benchmarked(401));
    const high = judgeStage(reach!, () => benchmarked(4_000_000));

    expect(low).toEqual(high);
    // @ts-expect-error a judgement carries a band, never a value
    expect(low.value).toBeUndefined();
  });
});

describe('judgeStages', () => {
  const lowReach = (stage: FunnelStage) =>
    stage === 'reach' ? benchmarked(50) : benchmarked(500);

  function statuses(
    platform: 'tiktok' | 'instagram',
    status: 'unbound' | 'dark' | 'measurable',
  ) {
    return stageReadings(platform, 'short_vertical')
      .filter((reading) => reading.status === status)
      .map((reading) => reading.stage);
  }

  it('judges every stage of a platform × format from the signal map', () => {
    // Instagram binds no Hook and no Audience for a Reel (FILM-1714).
    const judgements = judgeStages('instagram', 'short_vertical', lowReach);
    const diagnosis = diagnoseStages(judgements);

    expect(Object.keys(judgements)).toEqual([...FUNNEL_STAGES]);
    expect(diagnosis.coverage.excluded.unbound).toEqual([
      'hook',
      'audience',
      'monetisation',
    ]);
    expect(diagnosis.coverage.excluded.dark).toEqual(
      statuses('instagram', 'dark'),
    );
    expect(diagnosis.coverage.judgedCount).toBe(
      statuses('instagram', 'measurable').length,
    );
    expect(outcomeOf(diagnosis)).toBe('reach_below_content_above');
  });

  it('gives a platform with one measurable stage no pattern, whatever its bands', () => {
    // TikTok today: Hook and Audience unbound, Reach and Attention dark.
    const measurable = statuses('tiktok', 'measurable');
    const diagnosis = diagnoseStages(
      judgeStages('tiktok', 'short_vertical', lowReach),
    );

    expect(diagnosis.coverage.judgedCount).toBe(measurable.length);
    expect(diagnosis.kind).toBe(
      measurable.length < MIN_JUDGED_STAGES ? 'too_few_judged' : 'pattern',
    );
  });
});

describe('dependencies', () => {
  it('reads only the signal model and self-benchmarking, never the genome', () => {
    const source = readFileSync(
      join(__dirname, '../src/lib/stage-diagnosis.ts'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(
      (match) => match[1],
    );

    expect([...new Set(imports)].sort()).toEqual([
      '../types',
      './self-benchmark',
      './signal-map',
    ]);
  });
});
