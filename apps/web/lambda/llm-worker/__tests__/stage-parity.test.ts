import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withRun } from '@kit/ai-gateway';
import {
  type RecordedCall,
  fakeRunHandle,
  flattenRows,
  recordingClient,
  tableResponder,
  writesOf,
} from '@kit/generation/testing';

// FILM-1901 part C: parity for screenplay, screenplay_refinement,
// dialogue_translation and publish_metadata. The goldens under
// fixtures/parity/ were recorded from the handlers as they stood before the
// rewrite (`RECORD_PARITY=1`, the commit before the bodies were deleted),
// with the model stubbed to return the fixture below and the clock pinned.
// The rewritten handlers must issue the same writes, in the same order, and
// return the same result. Part A's stages are in generation-parity.test.ts.

const NOW = new Date('2026-10-03T12:00:00.000Z');

const IDS = {
  episodeId: '55555555-5555-4555-8555-555555555555',
  projectId: '22222222-2222-4222-8222-222222222222',
  accountId: '11111111-1111-4111-8111-111111111111',
  userId: '44444444-4444-4444-8444-444444444444',
  version: 3,
};

const CHARACTERS = [
  {
    id: 'c1',
    name: 'Maya',
    role: 'protagonist',
    description: 'A weary astronaut',
    personality: 'composed',
  },
  {
    id: 'c2',
    name: 'Houston',
    role: 'support',
    description: 'Mission control',
  },
];

const LOCATIONS = [
  {
    id: 'l1',
    name: 'Observation Deck',
    setting: 'interior',
    description: 'Glass and starlight',
  },
];

const STORY_DATA = {
  fullStory: 'Maya hears her own voice on the comm and must decide.',
  title: 'The Last Signal',
  tone: 'tense, intimate',
  actBreakdown: { act1: 'Setup', act2: 'Confrontation', act3: 'Resolution' },
  themes: ['identity', 'trust'],
  characters: [{ name: 'Maya', role: 'protagonist', arc: 'Learns to trust' }],
  keyEvents: ['The comm crackles with her own voice'],
  estimatedSceneCount: 2,
  targetDuration: 120,
  contentStyle: 'dialogue-heavy',
};

const SCENES = [
  {
    number: 1,
    heading: 'INT. OBSERVATION DECK - DAY',
    location: 'Observation Deck',
    timeOfDay: 'day',
    description: 'Maya floats at the window. Warning lights flicker.',
    action: ['Maya taps the comm panel.'],
    dialogue: [
      {
        character: 'Maya',
        text: '[urgently] Houston, this is Relay One. Please respond.',
        parenthetical: 'into comm',
      },
      { character: 'Houston', text: '[calmly] Relay One, we read you.' },
    ],
    emotionalPeak: 'Maya hears her own voice',
    hookOut: 'What was she about to warn herself about?',
    estimatedDuration: 45,
  },
  {
    number: 2,
    heading: 'INT. CONTROL ROOM - NIGHT',
    location: 'Control Room',
    timeOfDay: 'night',
    description: 'Empty consoles. One screen still glows.',
    action: [],
    dialogue: [{ character: 'NARRATOR', text: 'Three hours later.' }],
    estimatedDuration: 30,
  },
];

const EXISTING_SCREENPLAY = {
  scenes: SCENES,
  generatedAt: '2026-10-01T00:00:00.000Z',
  generatedBy: { model: 'screenplay-orchestrator', provider: 'multi-agent' },
  totalDialogueLines: 3,
  estimatedDuration: 75,
  approvedAt: null,
  metadata: {
    locations: ['Observation Deck', 'Control Room'],
    characters: ['Maya', 'Houston', 'NARRATOR'],
    totalScenes: 2,
    estimatedDuration: 75,
  },
};

const REFINED_SCREENPLAY = {
  scenes: [
    {
      ...SCENES[0],
      description: 'Maya floats at the window, calmer now.',
      dialogue: [
        {
          character: 'Maya',
          text: '[quietly] Houston, this is Relay One.',
          parenthetical: 'into comm',
        },
        { character: 'Houston', text: '[calmly] We read you, Maya.' },
      ],
    },
    SCENES[1],
  ],
  metadata: {
    totalScenes: 2,
    estimatedDuration: 75,
    totalDialogueLines: 3,
    locations: ['Observation Deck', 'Control Room'],
    characters: ['Maya', 'Houston', 'NARRATOR'],
  },
};

const EPISODE = {
  id: IDS.episodeId,
  number: 5,
  title: 'The Last Signal',
  version: 3,
  status: 'story',
  deleted_at: null,
  story_data: STORY_DATA,
  screenplay_data: EXISTING_SCREENPLAY,
  target_duration_seconds: 120,
  metadata: {
    character_ids: ['c1', 'c2'],
    location_ids: ['l1'],
    target_audience: 'kids 6-12',
    refinement_history: [
      {
        timestamp: '2026-10-01T00:00:00.000Z',
        feedback: 'Earlier note',
        type: 'story',
        userId: IDS.userId,
      },
    ],
  },
  project: {
    id: IDS.projectId,
    account_id: IDS.accountId,
    metadata: { genre: 'sci-fi', targetAudience: 'kids 6-12' },
  },
};

const ENGLISH_LINES = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    episode_id: IDS.episodeId,
    character_asset_id: 'c1',
    shot_id: null,
    text: '[urgently] Houston, this is Relay One. Please respond.',
    sequence_number: 1,
    scene_number: 1,
    timeline_start_seconds: 0,
    estimated_duration_seconds: 2.5,
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    episode_id: IDS.episodeId,
    character_asset_id: 'c2',
    shot_id: null,
    text: '[calmly] Relay One, we read you.',
    sequence_number: 2,
    scene_number: 1,
    timeline_start_seconds: 3,
    estimated_duration_seconds: null,
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    episode_id: IDS.episodeId,
    character_asset_id: null,
    shot_id: null,
    text: 'Three hours later.',
    sequence_number: 3,
    scene_number: 2,
    timeline_start_seconds: 6,
    estimated_duration_seconds: 1.5,
  },
];

// Numbered and quoted like the model returns them; the third is missing
const TRANSLATIONS = [
  '1. "[urgently] Houston, aquí Relay One. Por favor responde."',
  '2. [calmly] Relay One, te escuchamos.',
  '',
];

const METADATA_ITEMS = [
  {
    id: 'full-video-hi',
    contentType: 'full-video' as const,
    title: 'The Last Signal',
    description: 'An astronaut hears her own voice.',
    targetLanguage: 'hi',
  },
  {
    id: 'group-g1-es',
    contentType: 'shorts-group' as const,
    groupId: 'g1',
    title: 'Signal shorts',
    description: 'Three clips.',
    targetLanguage: 'es',
  },
];

const METADATA_TRANSLATIONS = [
  {
    id: 'full-video-hi',
    targetLanguage: 'hi',
    title: 'आखिरी सिग्नल',
    description: 'एक अंतरिक्ष यात्री अपनी ही आवाज़ सुनती है।',
  },
];

vi.mock('../utils/context-builder', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/context-builder')>();

  return {
    ...actual,
    buildEpisodeContext: vi.fn(async () => ({
      premise: '',
      episodeNumber: 5,
      seasonNumber: 1,
      characters: CHARACTERS,
      locations: LOCATIONS,
      seasonPremise: 'A relay station at the edge of the system',
      seasonDirectionNotes: 'Keep scenes tight',
      previousEpisodes: [],
      episodeFacts: [],
      verifiedFacts: [],
      genre: 'sci-fi',
      targetAudience: 'kids 6-12',
      visualStyle: 'balanced',
      recurringElements: undefined,
    })),
  };
});

vi.mock('@kit/episodes/agent/screenplay-orchestrator', () => ({
  runScreenplayOrchestrator: vi.fn(async () => ({
    success: true,
    scenes: SCENES,
    title: 'The Last Signal',
    totalDialogueLines: 3,
    estimatedDuration: 75,
    orchestratorSteps: 2,
  })),
}));

vi.mock('@kit/episodes/agent/translation-orchestrator', () => ({
  runTranslationOrchestrator: vi.fn(async () => ({
    success: true,
    translations: TRANSLATIONS,
    verificationScore: 0.9,
    verdict: 'pass',
    orchestratorSteps: 3,
  })),
}));

/** The client a commit's plan is replayed through: the handler's recording. */
type RunClient = NonNullable<
  Parameters<typeof fakeRunHandle>[0]
>['commitsThrough'];

/**
 * The run the handlers write through (FILM-1902): its backend answers the
 * screenplay-refinement brief the way the old Lambda executor stub did, and
 * refuses any other prompt, so a handler reaching the model for something
 * else fails here.
 */
function parityRun(commitsThrough?: RunClient) {
  return fakeRunHandle({
    commitsThrough,
    accountId: IDS.accountId,
    projectId: IDS.projectId,
    targetId: IDS.episodeId,
    createdBy: IDS.userId,
    backend: {
      write: async (_run, brief) => {
        if (brief.prompt.slug !== 'screenplay-refinement') {
          throw new Error(`unexpected run.write ${brief.prompt.slug}`);
        }

        return {
          output: { screenplay: REFINED_SCREENPLAY },
          usage: {
            tokens: 1234,
            latencyMs: 10,
            provider: 'gemini',
            model: 'gemini-test',
          },
        };
      },
      dispatch: async () => undefined,
    },
  }).run;
}

vi.mock('@kit/ai-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kit/ai-gateway')>()),
  executeLLM: vi.fn(async (input: { templateSlug: string }) => {
    switch (input.templateSlug) {
      case 'batch-translate-metadata':
        return { data: { translations: METADATA_TRANSLATIONS } };
      case 'quality-evaluation/screenplay-quality':
        return {
          data: {
            overallScore: 0.9,
            dimensions: {},
            critique: 'Fine',
            revisionPriority: 'none',
          },
        };
      default:
        throw new Error(`unexpected executeLLM ${input.templateSlug}`);
    }
  }),
}));

vi.mock('../utils/validation-checkpoint', () => ({
  runValidationCheckpoint: vi.fn(async () => ({ messages: [] })),
}));

function filterValue(call: RecordedCall, column: string) {
  return call.chain.find(
    (step) => step.method === 'eq' && step.args[0] === column,
  )?.args[1];
}

function responder() {
  const fixtures = tableResponder({
    episodes: EPISODE,
    generation_jobs: null,
    dialogue_lines: null,
  });

  return (call: RecordedCall) => {
    if (call.table === 'dialogue_lines' && writesOf([call]).length === 0) {
      const language = filterValue(call, 'language');

      if (language === 'en') return { data: ENGLISH_LINES };

      return { data: [] };
    }

    return fixtures(call);
  };
}

const FIXTURES = path.resolve(__dirname, 'fixtures/parity');

function expectGolden(name: string, actual: unknown) {
  const file = path.join(FIXTURES, `${name}.json`);
  const serialised = JSON.stringify(actual, null, 2) + '\n';

  if (process.env.RECORD_PARITY === '1') {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, serialised);
    return;
  }

  expect(
    existsSync(file),
    `${file} missing: record it with RECORD_PARITY=1 against the old handler`,
  ).toBe(true);
  expect(JSON.parse(serialised)).toEqual(
    JSON.parse(readFileSync(file, 'utf8')),
  );
}

describe('stage parity: the rewritten handlers write what the old ones wrote (FILM-1901)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('screenplay: screenplay_data, status storyboard, dialogue_lines rebuilt, job bookkeeping', async () => {
    const { processScreenplayConversion } = await import(
      '../handlers/screenplay-conversion'
    );
    const recording = recordingClient(responder());

    const result = await withRun(parityRun(recording.client), () =>
      processScreenplayConversion(
        { ...IDS, contentStyle: 'dialogue-heavy' },
        recording.client,
      ),
    );

    expectGolden('screenplay', {
      writes: flattenRows(recording.writes()),
      result,
    });
  });

  it('screenplay_refinement: screenplay_data, metadata history, dialogue_lines rebuilt', async () => {
    const { processScreenplayRefinement } = await import(
      '../handlers/screenplay-refinement'
    );
    const recording = recordingClient(responder());

    const result = await withRun(parityRun(recording.client), () =>
      processScreenplayRefinement(
        { ...IDS, feedback: 'Make Maya calmer in scene 1' },
        recording.client,
      ),
    );

    expectGolden('screenplay-refinement', {
      writes: flattenRows(recording.writes()),
      result,
    });
  });

  it('dialogue_translation: translated dialogue_lines inserted, missing lines fall back to English', async () => {
    const { processTranslateDialogue } = await import(
      '../handlers/translate-dialogue'
    );
    const recording = recordingClient(responder());

    const result = await withRun(parityRun(recording.client), () =>
      processTranslateDialogue(
        { ...IDS, targetLanguage: 'es', preserveTiming: true },
        recording.client,
      ),
    );

    expectGolden('dialogue-translation', {
      writes: flattenRows(recording.writes()),
      result,
    });
  });

  it('publish_metadata: translated items returned, untranslated ones fall back, nothing written', async () => {
    const { processBatchTranslateMetadata } = await import(
      '../handlers/batch-translate-metadata'
    );
    const recording = recordingClient(responder());

    const result = await withRun(parityRun(recording.client), () =>
      processBatchTranslateMetadata(
        { accountId: IDS.accountId, userId: IDS.userId, items: METADATA_ITEMS },
        recording.client,
      ),
    );

    expectGolden('publish-metadata', {
      writes: flattenRows(recording.writes()),
      result,
    });
  });
});
