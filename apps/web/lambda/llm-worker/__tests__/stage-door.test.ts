import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STAGE_OF_JOB, withRun } from '@kit/ai-gateway';
import {
  type RunBackend,
  type StageKey,
  StageKeySchema,
  executeServerRun,
  openRun,
  registeredStageKeys,
} from '@kit/generation';
import {
  MATRIX_FIXTURES,
  fakeRunHandle,
  matrixHarness,
  matrixRunTarget,
} from '@kit/generation/testing';
import type { LlmJobType } from '@kit/prompt-engine/llm-job-payloads';

import { fakeClient } from './helpers/injected-rows';

/**
 * FILM-1902 criterion 9, KB-184: the stages that reach run.write() are the
 * stage registry, and no model call happens outside a registered stage's
 * write. Every job handler of a registered stage, and `executeServerRun`
 * for every registered stage, runs under a run whose writer records the
 * stage and stops. The orchestrators and both gateway executors are stubbed
 * to record a call and stop too: a handler that reaches any of them before
 * run.write (its own generate, a direct executeLLM) is a model call outside
 * the stage's write, and fails here.
 *
 * analytics-insights and language-insights are not stages (FILM-1901
 * notes): they run under server-only keys, which have a run and no brief.
 */

const STOP = new Error('run.write reached: stage recorded');
const OUTSIDE = new Error('a model was reached outside run.write');

const reached: StageKey[] = [];
const outside: string[] = [];

function recordOutside(name: string) {
  return vi.fn(async () => {
    outside.push(name);
    throw OUTSIDE;
  });
}

vi.mock('@kit/episodes/agent/ideation-orchestrator', () => ({
  runIdeationOrchestrator: recordOutside('ideation orchestrator'),
}));
vi.mock('@kit/episodes/agent/story-orchestrator', () => ({
  runStoryOrchestrator: recordOutside('story orchestrator'),
}));
vi.mock('@kit/episodes/agent/shot-orchestrator', () => ({
  runShotOrchestrator: recordOutside('shot orchestrator'),
}));
vi.mock('@kit/episodes/agent/screenplay-orchestrator', () => ({
  runScreenplayOrchestrator: recordOutside('screenplay orchestrator'),
}));
vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: recordOutside('audio cue orchestrator'),
}));
vi.mock('@kit/episodes/agent/translation-orchestrator', () => ({
  runTranslationOrchestrator: recordOutside('translation orchestrator'),
}));
vi.mock('@kit/episodes/agent/season-orchestrator', () => ({
  runSeasonOrchestrator: recordOutside('season orchestrator'),
}));
vi.mock('@kit/ai-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/ai-gateway')>()),
  executeLLM: vi.fn(async (input: { templateSlug: string }) => {
    outside.push(`executeLLM ${input.templateSlug}`);
    throw OUTSIDE;
  }),
  executeLLMForLambda: vi.fn(async (input: { templateSlug: string }) => {
    outside.push(`executeLLMForLambda ${input.templateSlug}`);
    throw OUTSIDE;
  }),
}));
vi.mock('../utils/job-tracking', () => ({
  markJobProcessing: vi.fn(async () => undefined),
  markJobCompleted: vi.fn(async () => undefined),
  markJobFailed: vi.fn(async () => undefined),
}));

const IDS = {
  episodeId: '55555555-5555-4555-8555-555555555555',
  projectId: '22222222-2222-4222-8222-222222222222',
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
  version: 1,
};

const door: RunBackend = {
  write: async (_run, brief) => {
    reached.push(brief.stage);
    throw STOP;
  },
  dispatch: async () => undefined,
};

const doorRun = () =>
  fakeRunHandle({
    commitsThrough: fakeClient() as never,
    accountId: IDS.accountId,
    projectId: IDS.projectId,
    targetId: IDS.episodeId,
    createdBy: IDS.userId,
    backend: door,
  }).run;

const handler = async <T extends string>(
  file: string,
  name: T,
  payload: Record<string, unknown>,
) => {
  const module = (await import(`../handlers/${file}`)) as Record<
    T,
    (payload: Record<string, unknown>, client: unknown) => Promise<unknown>
  >;

  return module[name](payload, fakeClient());
};

/** Each LLM job of a registered stage, as the worker's router runs it. */
const STAGE_JOBS: Partial<Record<LlmJobType, () => Promise<unknown>>> = {
  'season-outline': () =>
    handler('season-outline', 'processSeasonOutline', {
      ...IDS,
      seasonPremise: 'A heist goes wrong',
      episodeCount: 3,
      startingNumber: 1,
    }),
  'season-analysis': () =>
    handler('season-analysis', 'processSeasonAnalysis', {
      accountId: IDS.accountId,
      projectId: IDS.projectId,
      roadmap: 'Three episodes',
    }),
  'story-ideation': () =>
    handler('story-ideation', 'processStoryIdeation', {
      ...IDS,
      premise: 'A heist goes wrong',
    }),
  'story-generation': () =>
    handler('story-generation', 'processStoryGeneration', {
      ...IDS,
      title: 'The Vault',
      logline: 'A heist goes wrong',
      targetDuration: 60,
      contentStyle: 'balanced',
    }),
  'story-refinement': () =>
    handler('story-refinement', 'processStoryRefinement', {
      ...IDS,
      feedback: 'Darker',
    }),
  'screenplay-conversion': () =>
    handler('screenplay-conversion', 'processScreenplayConversion', IDS),
  'screenplay-refinement': () =>
    handler('screenplay-refinement', 'processScreenplayRefinement', {
      ...IDS,
      feedback: 'Tighter',
    }),
  'shot-generation': () =>
    handler('shot-generation', 'processShotGeneration', IDS),
  'audio-cue-generation': () =>
    handler('audio-cue-generation', 'processAudioCueGeneration', IDS),
  'translate-dialogue': () =>
    handler('translate-dialogue', 'processTranslateDialogue', {
      ...IDS,
      targetLanguage: 'es',
      preserveTiming: true,
    }),
  'asset-creation': () =>
    handler('asset-creation', 'processAssetCreation', IDS),
  'fact-extraction': () =>
    handler('fact-extraction', 'processFactExtraction', {
      ...IDS,
      content: 'The vault opened in 1921.',
      sourceTitle: 'Archive',
      sourceCitation: 'p. 1',
    }),
  'batch-translate-metadata': () =>
    handler('batch-translate-metadata', 'processBatchTranslateMetadata', {
      accountId: IDS.accountId,
      items: [
        {
          id: 'i1',
          targetLanguage: 'es',
          title: 'The Vault',
          description: 'A heist goes wrong',
          contentType: 'full-video',
        },
      ],
    }),
};

const registry = registeredStageKeys();
const serverOnlyKeys = StageKeySchema.options.filter(
  (key) => !registry.includes(key),
);

beforeEach(() => {
  reached.length = 0;
  outside.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the stages that reach run.write() are the registry (FILM-1902, KB-184)', () => {
  it('every LLM job is a registered stage run here, or a server-only key', () => {
    for (const [job, stage] of Object.entries(STAGE_OF_JOB)) {
      if (registry.includes(stage)) {
        expect(STAGE_JOBS[job as LlmJobType], `${job} is run here`).toBeTypeOf(
          'function',
        );
      } else {
        expect(serverOnlyKeys, `${job} → ${stage}`).toContain(stage);
      }
    }
  });

  it.each(Object.keys(STAGE_JOBS).map((job) => [job as LlmJobType] as const))(
    '%s reaches run.write() for its stage, and no model before it',
    async (job) => {
      // A handler's own fallback may swallow the stop, so it is read from
      // what was recorded, not from the handler's result
      await withRun(doorRun(), STAGE_JOBS[job]!).catch(() => undefined);

      expect(outside, `${job} reached a model outside run.write`).toEqual([]);
      expect(reached[0], `${job} wrote through its run`).toBe(
        STAGE_OF_JOB[job],
      );
    },
  );

  it('the job handlers and executeServerRun together reach every registered stage, and only them', async () => {
    const all = new Set<StageKey>();

    for (const run of Object.values(STAGE_JOBS)) {
      reached.length = 0;
      await withRun(doorRun(), run!).catch(() => undefined);
      reached.forEach((stage) => all.add(stage));
    }

    // A stage-input run of every stage, as the worker's runWorkerStage
    // drives it (episode_summary has no job: canon-actions opens it)
    for (const key of registry) {
      const fixture = MATRIX_FIXTURES[key]!;
      const { ctx } = matrixHarness(fixture, 'server', door);
      const run = await openRun(
        key,
        matrixRunTarget(fixture),
        { kind: 'web', name: 'door' },
        ctx,
      );

      reached.length = 0;
      await executeServerRun(run, ctx).catch(() => undefined);
      expect(reached, key).toEqual([key]);
      all.add(key);
    }

    expect(outside).toEqual([]);
    expect([...all].sort()).toEqual([...registry].sort());
  });
});
