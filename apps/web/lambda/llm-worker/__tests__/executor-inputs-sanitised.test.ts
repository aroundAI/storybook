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
vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: recordAndStop('audio cue orchestrator'),
}));
vi.mock('@kit/episodes/agent/translation-orchestrator', () => ({
  runTranslationOrchestrator: recordAndStop('translation orchestrator'),
}));
vi.mock('@kit/episodes/agent/season-orchestrator', () => ({
  runSeasonOrchestrator: recordAndStop('season orchestrator'),
}));
vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: vi.fn(async (input: { templateSlug: string }) => {
    seen[input.templateSlug] = input;
    throw STOP;
  }),
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
  episodeId: '55555555-5555-4555-8555-555555555555',
  projectId: '22222222-2222-4222-8222-222222222222',
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
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
      seen['quality-evaluation/screenplay-quality'],
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
  it('fact extraction: the uploaded document, its title and citation', async () => {
    const { processFactExtraction } = await import(
      '../handlers/fact-extraction'
    );
    await run(() =>
      processFactExtraction(
        { ...IDS, content: P, sourceTitle: P, sourceCitation: P },
        fakeClient(),
      ),
    );

    expectSanitised(
      seen['documentary/fact-extraction'],
      'documentary/fact-extraction',
    );
  });

  it('analytics insights: content titles and platforms in the payload', async () => {
    const { processAnalyticsInsights } = await import(
      '../handlers/analytics-insights'
    );
    await run(() =>
      processAnalyticsInsights(
        {
          ...IDS,
          analytics: {
            totals: {
              views: 10,
              likes: 1,
              comments: 1,
              shares: 1,
              watchTimeSeconds: 1,
              subscribersGained: 1,
              revenueCents: 1,
              contentCount: 1,
            },
            platformMetrics: [
              { platform: P, views: 1, likes: 1, comments: 1, shares: 1 },
            ],
            topContent: [
              {
                id: 'v1',
                title: P,
                views: 1,
                likes: 1,
                engagementRate: 1,
                platform: P,
              },
            ],
            audience: { note: P },
            contentCount: 1,
            avgEngagementRate: 1,
          },
        },
        fakeClient(),
      ),
    );

    expectSanitised(seen['insights-generation'], 'insights-generation');
  });

  it('language insights: languages, platforms, shorts and geography', async () => {
    const { processLanguageInsights } = await import(
      '../handlers/language-insights'
    );
    await run(() =>
      processLanguageInsights(
        {
          ...IDS,
          languagePerformance: [
            { language: P, views: 1, likes: 1, comments: 1, engagementRate: 1 },
          ],
          platformMatrix: [{ platform: P }],
          contentType: { label: P },
          shorts: [{ title: P }],
          geography: { region: P },
        },
        fakeClient(),
      ),
    );

    expectSanitised(seen['language-insights'], 'language-insights');
  });

  it('batch metadata translation: titles and descriptions', async () => {
    const { processBatchTranslateMetadata } = await import(
      '../handlers/batch-translate-metadata'
    );
    await run(() =>
      processBatchTranslateMetadata(
        {
          items: [
            {
              id: 'i1',
              targetLanguage: 'es',
              title: P,
              description: P,
              contentType: 'full-video',
            },
          ],
        },
        fakeClient(),
      ),
    );

    expectSanitised(
      seen['batch-translate-metadata'],
      'batch-translate-metadata',
    );
  });

  it('asset creation: names and the screenplay context', async () => {
    const { processAssetCreation } = await import('../handlers/asset-creation');
    await run(() => processAssetCreation({ ...IDS }, fakeClient()));

    expectSanitised(
      seen['story-generation/extract-asset-description'],
      'extract-asset-description',
    );
  });

  it('audio cues: the stored shots', async () => {
    const { processAudioCueGeneration } = await import(
      '../handlers/audio-cue-generation'
    );
    await run(() => processAudioCueGeneration({ ...IDS }, fakeClient()));

    expectSanitised(seen['audio cue orchestrator'], 'audio cue orchestrator');
  });

  it('dialogue translation: the stored lines and audience', async () => {
    const { processTranslateDialogue } = await import(
      '../handlers/translate-dialogue'
    );
    await run(() =>
      processTranslateDialogue(
        { ...IDS, targetLanguage: 'es', preserveTiming: true },
        fakeClient(),
      ),
    );

    expectSanitised(
      seen['translation orchestrator'],
      'translation orchestrator',
    );
  });

  it('season analysis: the roadmap and the facts in the payload', async () => {
    const { processSeasonAnalysis } = await import(
      '../handlers/season-analysis'
    );
    await run(() =>
      processSeasonAnalysis(
        {
          projectId: 'p1',
          roadmap: P,
          externalFacts: [
            { id: 'f1', claim: P, source_citation: P, category: P },
          ],
        },
        fakeClient(),
      ),
    );

    expectSanitised(seen['season-generation'], 'season-generation');
  });

  it('season outline: the premise, genre, style and the project text', async () => {
    const { processSeasonOutline } = await import('../handlers/season-outline');
    await run(() =>
      processSeasonOutline(
        {
          ...IDS,
          seasonPremise: P,
          episodeCount: 3,
          startingNumber: 1,
          genre: P,
          style: P,
        },
        fakeClient(),
      ),
    );

    expectSanitised(seen['season orchestrator'], 'season orchestrator');
  });
});

/**
 * Every handler that calls an executor is either covered above or named
 * here as not yet covered, with the lead that tracks it. A new handler fails
 * this until someone decides which.
 */
const COVERED = [
  'analytics-insights.ts',
  'asset-creation.ts',
  'audio-cue-generation.ts',
  'batch-translate-metadata.ts',
  'fact-extraction.ts',
  'language-insights.ts',
  'screenplay-conversion.ts',
  'screenplay-refinement.ts',
  'season-analysis.ts',
  'season-outline.ts',
  'shot-generation.ts',
  'story-generation.ts',
  'story-ideation.ts',
  'story-refinement.ts',
  'translate-dialogue.ts',
];
const NOT_YET_COVERED: string[] = [];

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
