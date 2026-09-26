import { corpus, drawCast, paragraph } from '../../corpus';
import type { Rng } from '../../rng';
import { type Conversation, block, field, integer, range } from './protocol';

/**
 * One script per orchestrator the llm-worker runs
 * (`packages/features/episodes/src/agent/*-orchestrator.ts`). Each is
 * recognised by the first line of its system prompt and calls its tools in
 * the order that prompt prescribes, with parameters taken from the
 * orchestrator's own user prompt and from what earlier tools returned - what
 * a model following the prompt would pass. The runner validates every call
 * against the tool's own Zod schema, so a script that drifts from a tool
 * fails the orchestrator test, not a demo.
 *
 * Quality gates pass first time (the prompt generators score high), so no
 * script needs a revision loop.
 */

export interface ScriptContext {
  conversation: Conversation;
  /** Tools the runner offered, in its order. */
  tools: string[];
  rng: Rng;
}

interface Step {
  tool: string;
  params: (s: ScriptContext) => Record<string, unknown>;
}

export interface OrchestratorScript {
  name: string;
  /** The first line of the orchestrator's system prompt. */
  signature: string;
  steps: Step[];
  final: (s: ScriptContext) => unknown;
}

const user = (s: ScriptContext) => s.conversation.userPrompt;
const f = (s: ScriptContext, label: string) => field(user(s), label);
const b = (s: ScriptContext, label: string) => block(user(s), label);

function last(s: ScriptContext, tool: string) {
  return (
    s.conversation.calls.filter((c) => c.tool === tool).at(-1)?.result ??
    undefined
  );
}

function num(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Drops undefined values, so optional parameters are simply absent. */
function defined(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined),
  );
}

function sentence(s: ScriptContext) {
  return paragraph(s.rng, drawCast(s.rng), 1);
}

const CONTENT_STYLES = ['dialogue-heavy', 'balanced', 'action-heavy'];

function contentStyle(s: ScriptContext) {
  const style = f(s, 'Content Style');
  return style && CONTENT_STYLES.includes(style) ? style : 'dialogue-heavy';
}

/** The scenes JSON the prompt embeds; the block ends with an instruction line. */
function scenesFromPrompt(s: ScriptContext) {
  const text = b(s, 'Scenes to Process') ?? '';
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  try {
    const scenes = json ? (JSON.parse(json) as unknown) : [];
    return Array.isArray(scenes) ? scenes : [];
  } catch {
    return [];
  }
}

const ideation: OrchestratorScript = {
  name: 'ideation-orchestrator',
  signature: 'You are the Ideation Pipeline Director',
  steps: [
    {
      tool: 'generateIdeas',
      params: (s) =>
        defined({
          premise: f(s, 'Premise') ?? '',
          numberOfIdeas: integer(
            /Generate and evaluate (\d+) story ideas/.exec(user(s))?.[1],
            3,
          ),
          genre: f(s, 'Genre') ?? '',
          targetAudience: f(s, 'Target Audience') ?? '',
          charactersContext: b(s, 'Character Context'),
          locationsContext: b(s, 'Location Context'),
          seasonContext: b(s, 'Season Context'),
          previousEpisodes: b(s, 'Previous Episodes'),
          visualStyle: b(s, 'Visual Style'),
          recurringElements: b(s, 'Recurring Episode Elements'),
        }),
    },
    {
      tool: 'evaluateIdeas',
      params: (s) => ({
        ideas: JSON.stringify(last(s, 'generateIdeas')?.titles ?? []),
        genre: f(s, 'Genre') ?? '',
        targetAudience: f(s, 'Target Audience') ?? '',
      }),
    },
  ],
  final: (s) => ({
    ideas: [],
    evaluationSummary: `${num(last(s, 'generateIdeas')?.count, 0)} ideas generated and evaluated; no regeneration needed.`,
  }),
};

const DIMENSIONS = [
  'hookStrength',
  'curiosityGap',
  'emotionalArc',
  'setupPayoff',
  'dialogueSubtext',
  'loopability',
  'memorableMoment',
];

const story: OrchestratorScript = {
  name: 'story-orchestrator',
  signature: 'You are the Story Pipeline Director',
  steps: [
    {
      tool: 'identifyResearchNeeds',
      params: (s) =>
        defined({
          topic: f(s, 'Episode') ?? '',
          premise: f(s, 'Logline'),
          existingFacts: b(s, 'Verified Facts'),
        }),
    },
    {
      tool: 'generateStory',
      params: (s) =>
        defined({
          title: f(s, 'Episode') ?? '',
          logline: f(s, 'Logline') ?? '',
          genre: f(s, 'Genre') ?? '',
          targetAudience: f(s, 'Target Audience') ?? '',
          targetDurationSeconds: integer(f(s, 'Duration'), 120),
          contentStyle: contentStyle(s),
          characters: b(s, 'Character Context'),
          locations: b(s, 'Location Context'),
          seasonContext: b(s, 'Season Context'),
          previousEpisodes: b(s, 'Previous Episodes'),
          ideationThemes: f(s, 'Thematic Direction'),
          ideationHook: f(s, 'Narrative Hook'),
          visualDirection: f(s, 'Visual Direction'),
          recurringElements: b(s, 'Recurring Episode Elements'),
        }),
    },
    {
      tool: 'evaluateContent',
      params: (s) => {
        const story = last(s, 'generateStory');
        return {
          title: String(story?.title ?? f(s, 'Episode') ?? ''),
          genre: f(s, 'Genre') ?? '',
          targetAudience: f(s, 'Target Audience') ?? '',
          targetDuration: integer(f(s, 'Duration'), 120),
          storyText: String(story?.episodeSummary ?? f(s, 'Logline') ?? ''),
        };
      },
    },
    {
      tool: 'factCheckContent',
      params: (s) =>
        defined({
          content: String(
            last(s, 'generateStory')?.episodeSummary ?? f(s, 'Logline') ?? '',
          ),
          verifiedFacts:
            b(s, 'Verified Facts') ?? 'No verified facts provided.',
        }),
    },
    {
      tool: 'buildMemoryContext',
      params: (s) => ({ episodeNumber: integer(f(s, 'Episode Number'), 1) }),
    },
    {
      tool: 'checkContinuity',
      params: (s) => {
        const cast = drawCast(s.rng);
        const episodeNumber = integer(f(s, 'Episode Number'), 1);
        return {
          episodeNumber,
          plotSkeleton: {
            premise: f(s, 'Logline') ?? '',
            episodeNumber,
            characters: cast.people.map((name, i) => ({
              characterId: name.toLowerCase().replace(/[^a-z]+/g, '-'),
              name,
              role: i === 0 ? 'protagonist' : 'supporting',
            })),
            scenes: cast.locations.map((location, i) => ({
              sceneNumber: i + 1,
              summary: paragraph(s.rng, cast, 1),
              location,
              charactersPresent: cast.people.slice(0, 2),
            })),
          },
        };
      },
    },
    {
      tool: 'extractActContext',
      params: (s) => ({
        actNumber: integer(f(s, 'Act Number'), 1),
        actContent: String(
          last(s, 'generateStory')?.episodeSummary ?? f(s, 'Logline') ?? '',
        ),
      }),
    },
  ],
  final: (s) => {
    const review = last(s, 'evaluateContent');
    const scores = (review?.dimensionScores ?? {}) as Record<string, unknown>;
    return {
      overallScore: num(review?.overallScore, 0.82),
      decision: 'pass',
      whyThisWorks: sentence(s),
      whatToImprove: s.rng.pick(corpus.critiques),
      dimensionScores: Object.fromEntries(
        DIMENSIONS.map((d) => [
          d,
          num(scores[d], Math.round(s.rng.float(0.7, 0.95) * 100) / 100),
        ]),
      ),
      revisionsApplied: [],
    };
  },
};

const screenplay: OrchestratorScript = {
  name: 'screenplay-orchestrator',
  signature: 'You are the Screenplay Pipeline Director',
  steps: [
    {
      tool: 'generateScreenplay',
      params: (s) => {
        const [sceneCountMin, sceneCountMax] = range(
          f(s, 'Expected Scene Range'),
          [3, 6],
        );
        const [linesMin, linesMax] = range(
          f(s, 'Dialogue Lines Per Scene'),
          [2, 6],
        );
        return {
          characterNames: f(s, 'Character Names') ?? '',
          locationNames: f(s, 'Location Names') ?? '',
          genre: f(s, 'Genre') ?? '',
          targetAudience: f(s, 'Target Audience') ?? '',
          targetDurationSeconds: integer(
            /\((\d+)s\)/.exec(f(s, 'Duration') ?? '')?.[1],
            120,
          ),
          contentStyle: contentStyle(s),
          sceneCountMin,
          sceneCountMax,
          dialogueLinesPerSceneMin: linesMin,
          dialogueLinesPerSceneMax: linesMax,
        };
      },
    },
  ],
  final: (s) => {
    const result = last(s, 'generateScreenplay');
    return {
      screenplayTitle: String(result?.title ?? f(s, 'Episode') ?? ''),
      sceneCount: num(result?.sceneCount, 0),
      qualityNote:
        'Scene count is within the expected range; no revision needed.',
    };
  },
};

const season: OrchestratorScript = {
  name: 'season-orchestrator',
  signature: 'You are the Season Pipeline Director',
  steps: [
    {
      tool: 'generateSeasonOutline',
      params: (s) =>
        defined({
          seasonPremise: f(s, 'Season Premise') ?? '',
          episodeCount: integer(f(s, 'Episode Count'), 4),
          startingNumber: integer(f(s, 'Starting Episode Number'), 1),
          genre: f(s, 'Genre') ?? '',
          style: f(s, 'Style'),
          existingCharacters: b(s, 'Character Context'),
          existingLocations: b(s, 'Location Context'),
          recurringElements: b(s, 'Recurring Elements'),
        }),
    },
    {
      tool: 'evaluateSeasonArc',
      params: (s) => ({
        episodes: JSON.stringify(
          last(s, 'generateSeasonOutline')?.titles ?? [],
        ),
        genre: f(s, 'Genre') ?? '',
        seasonPremise: f(s, 'Season Premise') ?? '',
      }),
    },
  ],
  final: (s) => {
    const review = last(s, 'evaluateSeasonArc');
    return {
      episodes: [],
      arcScore: num(review?.overallArcScore, 0.84),
      arcSummary: sentence(s),
    };
  },
};

const shot: OrchestratorScript = {
  name: 'shot-orchestrator',
  signature: 'You are the Shot Pipeline Director',
  steps: [
    {
      tool: 'analyzeScenes',
      params: (s) => ({
        episodeTitle: f(s, 'Episode') ?? '',
        genre: f(s, 'Genre') ?? '',
        scenes: scenesFromPrompt(s),
      }),
    },
    {
      tool: 'generateShots',
      params: (s) =>
        defined({
          episodeTitle: f(s, 'Episode') ?? '',
          genre: f(s, 'Genre') ?? '',
          targetAudience: f(s, 'Target Audience') ?? '',
          visualStyle: f(s, 'Visual Style') ?? '',
          characters: b(s, 'VEO Character Context') ?? 'No character context.',
          locations: b(s, 'VEO Location Context') ?? 'No location context.',
          scenes: scenesFromPrompt(s),
          reelCandidateScenes:
            (last(s, 'analyzeScenes')?.topReelCandidates as
              | number[]
              | undefined) ?? [],
          recurringElements: b(s, 'Recurring Story Elements'),
        }),
    },
    {
      tool: 'evaluateShotQuality',
      params: (s) => ({
        episodeTitle: f(s, 'Episode') ?? '',
        genre: f(s, 'Genre') ?? '',
        totalScenes: integer(f(s, 'Total Scenes'), scenesFromPrompt(s).length),
        shotsJson: JSON.stringify(last(s, 'generateShots') ?? {}),
      }),
    },
  ],
  final: (s) => {
    const quality = last(s, 'evaluateShotQuality');
    return {
      totalShotsGenerated: num(last(s, 'generateShots')?.totalShots, 0),
      reelCandidates:
        (last(s, 'analyzeScenes')?.topReelCandidates as number[] | undefined) ??
        [],
      shotQualityScore: num(quality?.overallScore, 0.86),
      shotQualityDecision: 'pass',
      completionNote: 'Every scene has shots, and the quality check passed.',
    };
  },
};

const audioCue: OrchestratorScript = {
  name: 'audio-cue-orchestrator',
  signature: 'You are the Audio Cue Pipeline Director',
  steps: [
    {
      tool: 'generateAudioCues',
      params: (s) => ({ shotsJson: b(s, 'Shot Data') ?? '[]' }),
    },
    {
      tool: 'evaluateAudioCues',
      params: (s) => ({
        cuesJson: JSON.stringify(last(s, 'generateAudioCues') ?? {}),
        shotsJson: b(s, 'Shot Data') ?? '[]',
        totalDurationSeconds: integer(f(s, 'Total Duration'), 60),
      }),
    },
  ],
  final: (s) => {
    const review = last(s, 'evaluateAudioCues');
    return {
      cues: [],
      coveragePercent: num(review?.coveragePercent, 78),
      verdict: 'pass',
    };
  },
};

const translation: OrchestratorScript = {
  name: 'translation-orchestrator',
  signature: 'You are the Translation Pipeline Director',
  steps: [
    {
      tool: 'translateDialogue',
      params: (s) => ({
        dialogueLines: b(s, 'Dialogue Lines to Translate') ?? '',
        targetLanguage: (f(s, 'Target Language') ?? '').replace(
          /\s*\(.*\)$/,
          '',
        ),
        preserveTiming: (f(s, 'Preserve Timing') ?? '').startsWith('Yes'),
      }),
    },
    {
      tool: 'verifyTranslation',
      params: (s) => ({
        originalLines: b(s, 'Dialogue Lines to Translate') ?? '',
        translatedLines: (
          (last(s, 'translateDialogue')?.translations as
            | string[]
            | undefined) ?? []
        ).join('\n'),
        targetLanguage: (f(s, 'Target Language') ?? '').replace(
          /\s*\(.*\)$/,
          '',
        ),
        preserveTiming: (f(s, 'Preserve Timing') ?? '').startsWith('Yes'),
      }),
    },
  ],
  final: (s) => {
    const review = last(s, 'verifyTranslation');
    return {
      translations:
        (last(s, 'translateDialogue')?.translations as string[] | undefined) ??
        [],
      verificationScore: num(review?.overallScore ?? review?.score, 0.88),
      verdict: 'pass',
    };
  },
};

/** Every orchestrator the llm-worker's handlers run. */
export const ORCHESTRATOR_SCRIPTS: OrchestratorScript[] = [
  ideation,
  story,
  screenplay,
  season,
  shot,
  audioCue,
  translation,
];

export function scriptFor(systemPrompt: string) {
  return ORCHESTRATOR_SCRIPTS.find((script) =>
    systemPrompt.startsWith(script.signature),
  );
}

export type AgentReply =
  | {
      kind: 'tool_call';
      tool: string;
      params: Record<string, unknown>;
      step: number;
    }
  | { kind: 'final_answer'; result: unknown; step: number };

/**
 * The next move: the first scripted tool the runner offers that has not been
 * called yet, or the final answer once none is left.
 */
export function nextMove(
  script: OrchestratorScript,
  s: ScriptContext,
): AgentReply {
  const called = new Set(s.conversation.calls.map((c) => c.tool));
  const step = s.conversation.calls.length + 1;
  const next = script.steps.find(
    (st) => s.tools.includes(st.tool) && !called.has(st.tool),
  );

  return next
    ? { kind: 'tool_call', tool: next.tool, params: next.params(s), step }
    : { kind: 'final_answer', result: script.final(s), step };
}
