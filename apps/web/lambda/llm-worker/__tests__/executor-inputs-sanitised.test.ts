import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { P, expectSanitised, fakeClient } from './helpers/injected-rows';

// KB-101 (remaining paths). Project text reaches the LLM worker's executors
// from three places: the context builders (prompt-sanitising.test.ts), the
// episode rows a handler reads itself (story, screenplay, title, project
// metadata), and the job payload (premise, title, logline, feedback, thread
// names). Every handler below is run with an injection payload in all of
// them; its executor — an orchestrator or an LLM call — is stubbed to
// record what it was given and stop the run. Nothing it was given may carry
// the payload raw.

const STOP = new Error('executor reached: input recorded');

const seen: Record<string, unknown> = {};

function recordAndStop(name: string) {
  return vi.fn(async (input: unknown) => {
    seen[name] = input;
    throw STOP;
  });
}

vi.mock('@kit/episodes/agent/ideation-orchestrator', () => ({
  runIdeationOrchestrator: recordAndStop('ideation orchestrator'),
}));
vi.mock('@kit/episodes/agent/story-orchestrator', () => ({
  runStoryOrchestrator: recordAndStop('story orchestrator'),
}));
vi.mock('@kit/episodes/agent/shot-orchestrator', () => ({
  runShotOrchestrator: recordAndStop('shot orchestrator'),
}));
vi.mock('@kit/episodes/agent/screenplay-orchestrator', () => ({
  // Succeeds, echoing the payload as its scenes, so the quality evaluation
  // after it is reached too: model output is text on its way to a prompt.
  runScreenplayOrchestrator: vi.fn(async (input: unknown) => {
    seen['screenplay orchestrator'] = input;
    return {
      success: true,
      scenes: [
        { number: 1, heading: P, description: P, action: [P], dialogue: [] },
      ],
    };
  }),
}));
vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: recordAndStop('screenplay quality evaluation'),
}));
vi.mock('../llm-utils', () => ({
  executeLLMForLambda: vi.fn(async (input: { templateSlug: string }) => {
    seen[input.templateSlug] = input;
    throw STOP;
  }),
}));
vi.mock('../utils/job-tracking', () => ({
  markJobProcessing: vi.fn(async () => undefined),
  markJobCompleted: vi.fn(async () => undefined),
  markJobFailed: vi.fn(async () => undefined),
}));
vi.mock('../utils/validation-checkpoint', () => ({
  runValidationCheckpoint: vi.fn(async () => ({ messages: [] })),
}));

const IDS = {
  episodeId: 'e5',
  projectId: 'p1',
  accountId: 'a1',
  userId: 'u1',
  version: 1,
};

async function run(handler: () => Promise<unknown>) {
  await handler().catch((error: unknown) => {
    if (error !== STOP) throw error;
  });
}

describe('executor inputs carry no raw project text (KB-101)', () => {
  beforeEach(() => {
    for (const key of Object.keys(seen)) delete seen[key];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('story ideation: the payload premise', async () => {
    const { processStoryIdeation } = await import('../handlers/story-ideation');
    await run(() => processStoryIdeation({ ...IDS, premise: P }, fakeClient()));

    expectSanitised(seen['ideation orchestrator'], 'ideation orchestrator');
  });

  it('story generation: title, logline, themes, hook, direction, thread names', async () => {
    const { processStoryGeneration } = await import(
      '../handlers/story-generation'
    );
    await run(() =>
      processStoryGeneration(
        {
          ...IDS,
          title: P,
          logline: P,
          targetDuration: 60,
          contentStyle: 'balanced',
          themes: [P],
          hook: P,
          visualDirection: P,
          threadCandidates: [
            { threadId: 't1', threadName: P, action: 'progress' },
          ],
        },
        fakeClient(),
      ),
    );

    expectSanitised(seen['story orchestrator'], 'story orchestrator');
  });

  it('story refinement: the current story and the feedback', async () => {
    const { processStoryRefinement } = await import(
      '../handlers/story-refinement'
    );
    await run(() =>
      processStoryRefinement({ ...IDS, feedback: P }, fakeClient()),
    );

    expectSanitised(seen['story-refinement'], 'story-refinement');
  });

  it('screenplay refinement: the screenplay, the story and the feedback', async () => {
    const { processScreenplayRefinement } = await import(
      '../handlers/screenplay-refinement'
    );
    await run(() =>
      processScreenplayRefinement({ ...IDS, feedback: P }, fakeClient()),
    );

    expectSanitised(seen['screenplay-refinement'], 'screenplay-refinement');
  });

  it('screenplay conversion: the story, the title, the project, and the quality check', async () => {
    const { processScreenplayConversion } = await import(
      '../handlers/screenplay-conversion'
    );
    await run(() => processScreenplayConversion({ ...IDS }, fakeClient()));

    expectSanitised(seen['screenplay orchestrator'], 'screenplay orchestrator');
    expectSanitised(
      seen['screenplay quality evaluation'],
      'screenplay quality evaluation',
    );
  });

  it('shot generation: the stored screenplay scenes and the title', async () => {
    const { processShotGeneration } = await import(
      '../handlers/shot-generation'
    );
    await run(() => processShotGeneration({ ...IDS }, fakeClient()));

    expectSanitised(seen['shot orchestrator'], 'shot orchestrator');
  });
});

/**
 * Every handler that calls an executor is either covered above or named
 * here as not yet covered, with the lead that tracks it. A new handler fails
 * this until someone decides which.
 */
const COVERED = [
  'screenplay-conversion.ts',
  'screenplay-refinement.ts',
  'shot-generation.ts',
  'story-generation.ts',
  'story-ideation.ts',
  'story-refinement.ts',
];
// specs/known-bugs/leads/2026-09-25-kb-101.md, "handlers not yet covered"
const NOT_YET_COVERED = [
  'analytics-insights.ts',
  'asset-creation.ts',
  'audio-cue-generation.ts',
  'batch-translate-metadata.ts',
  'fact-extraction.ts',
  'language-insights.ts',
  'season-analysis.ts',
  'season-outline.ts',
  'translate-dialogue.ts',
];

describe('every executor-calling handler is accounted for (KB-101)', () => {
  it('is covered, or named as not yet covered', () => {
    const dir = path.resolve(__dirname, '../handlers');
    const callers = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /executeLLM|Orchestrator\(/.test(
          readFileSync(path.join(dir, file), 'utf8'),
        ),
      )
      .sort();

    expect(callers).toEqual([...COVERED, ...NOT_YET_COVERED].sort());
  });
});
