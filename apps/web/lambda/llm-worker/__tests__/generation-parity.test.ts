import type { SupabaseClient } from '@supabase/supabase-js';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RecordedCall,
  flattenRows,
  recordingClient,
  tableResponder,
  writesOf,
} from '@kit/generation/testing';
import type { Database } from '@kit/supabase/database';

/**
 * FILM-1901 parity: a fixture model output through the handler writes the
 * same rows, and sends the model the same prompt variables, as it did
 * before the handler moved onto `@kit/generation`.
 *
 * The fixtures under `fixtures/parity/` were recorded against the old
 * handler bodies (`RECORD_PARITY=1`) in the commit before those bodies
 * were deleted; this test compares the new path against them. Re-recording
 * is a deliberate act, done only when the rows are meant to change.
 */

const FIXTURES = path.resolve(__dirname, 'fixtures/parity');
const RECORD = process.env.RECORD_PARITY === '1';
const NOW = new Date('2026-10-03T12:00:00.000Z');

const EPISODE_ID = '55555555-5555-4555-8555-555555555555';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const executorCalls: Array<{ templateSlug: string; variables: unknown }> = [];

const MODEL_OUTPUT: Record<string, unknown> = {
  'story-refinement': {
    story: {
      title: 'The Last Signal (darker)',
      fullText: 'Maya floats in the silence. This time, nobody answers.',
      actBreakdown: { act1: 'Setup', act2: 'Confrontation', act3: 'Silence' },
      characters: [
        { name: 'Maya Chen', role: 'protagonist', arc: 'From hope to resolve' },
      ],
      themes: ['isolation', 'sacrifice'],
      tone: 'bleak',
      estimatedSceneCount: 7,
      episodeSummary: 'Maya hears a signal and chooses silence.',
      sentimentScore: 0.3,
      keyEvents: ['Maya hears the signal', 'Maya cuts the transmitter'],
    },
    newCharacters: [],
    newLocations: [],
  },
  'story-generation/extract-asset-description': {
    description: 'A tall engineer with cropped grey hair and tired eyes.',
  },
};

vi.mock('../llm-utils', () => ({
  executeLLMForLambda: vi.fn(
    async (input: { templateSlug: string; variables: unknown }) => {
      executorCalls.push({
        templateSlug: input.templateSlug,
        variables: input.variables,
      });

      return {
        data: MODEL_OUTPUT[input.templateSlug],
        metadata: {
          tokens: 1234,
          latency: 10,
          provider: 'gemini',
          model: 'gemini-3.5-flash',
        },
      };
    },
  ),
}));

vi.mock('../utils/context-builder', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../utils/context-builder')>();

  return {
    ...original,
    buildEpisodeContext: vi.fn(async () => ({
      premise: 'A lone commander hears a signal',
      episodeNumber: 3,
      seasonNumber: 1,
      characters: [
        {
          id: 'c1',
          name: 'Maya Chen',
          role: 'protagonist',
          description: 'Commander of the deep-space relay',
          personality: 'steady',
        },
      ],
      locations: [
        {
          id: 'l1',
          name: 'Observation deck',
          setting: 'interior',
          description: 'A glass dome over the void',
        },
      ],
      seasonPremise: 'Humanity listens for an answer',
      seasonDirectionNotes: 'Keep the silence heavy',
      previousEpisodes: [
        {
          number: 2,
          title: 'First Contact',
          summary: 'The relay picks up a pattern.',
          keyEvents: ['Pattern detected'],
          relation: 'recent' as const,
        },
      ],
    })),
  };
});

const STORY_DATA = {
  title: 'The Last Signal',
  fullStory: 'Commander Maya Chen floats in the silence...',
  actBreakdown: { act1: 'a', act2: 'b', act3: 'c' },
  characters: [{ name: 'Maya Chen', role: 'protagonist', arc: 'routine' }],
  themes: ['isolation'],
  tone: 'contemplative',
  estimatedSceneCount: 8,
  episodeSummary: 'Maya discovers a signal.',
  sentimentScore: 0.6,
  keyEvents: ['Signal found'],
  viralStructure: { openingHook: 'An alarm' },
};

const EPISODE_METADATA = {
  character_ids: ['c1'],
  character_names: ['Maya Chen'],
  refinement_history: [
    {
      timestamp: '2026-10-01T00:00:00.000Z',
      feedback: 'More tension',
      type: 'story',
      userId: USER_ID,
    },
  ],
};

const SCREENPLAY_DATA = {
  metadata: {
    characters: ['Maya Chen', 'Dr. Osei'],
    locations: ['Observation deck'],
  },
  scenes: [
    {
      number: 1,
      heading: 'INT. OBSERVATION DECK - NIGHT',
      location: 'Observation deck',
      description: 'Maya watches the monitor.',
      dialogue: [
        { character: 'Maya Chen', text: 'There it is again.' },
        { character: 'Dr. Osei', text: 'Log it.', parenthetical: 'tired' },
      ],
    },
  ],
};

function storyRefinementClient() {
  return recordingClient(
    tableResponder({
      episodes: {
        id: EPISODE_ID,
        title: 'The Last Signal',
        status: 'story',
        story_data: STORY_DATA,
        metadata: EPISODE_METADATA,
        version: 4,
        deleted_at: null,
        project: { id: PROJECT_ID, account_id: ACCOUNT_ID },
      },
      generation_jobs: null,
    }),
  );
}

function assetCreationClient() {
  const existing = [{ id: 'asset-maya', name: 'Maya Chen', type: 'character' }];

  return recordingClient((call: RecordedCall) => {
    if (call.table === 'episodes') {
      return {
        data: {
          id: EPISODE_ID,
          screenplay_data: SCREENPLAY_DATA,
          metadata: { character_ids: ['asset-maya'] },
        },
      };
    }

    if (call.table === 'assets') {
      const write = writesOf([call])[0];

      if (!write) return { data: existing };

      const rows = Array.isArray(write.payload)
        ? write.payload
        : [write.payload];

      return {
        data: rows.map((row) => ({
          id: `asset-new-${(row as { name: string }).name}`,
          name: (row as { name: string }).name,
          type: (row as { type: string }).type,
        })),
      };
    }

    return undefined;
  });
}

function snapshot(name: string, value: unknown) {
  const file = path.join(FIXTURES, `${name}.json`);
  const serialised = JSON.stringify(value, null, 2) + '\n';

  if (RECORD) {
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

beforeEach(() => {
  executorCalls.length = 0;
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

describe('story refinement writes what it did before the core (FILM-1901)', () => {
  it('rows and prompt variables match the recorded fixture', async () => {
    const { processStoryRefinement } = await import(
      '../handlers/story-refinement'
    );
    const recording = storyRefinementClient();

    const result = await processStoryRefinement(
      {
        accountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        episodeId: EPISODE_ID,
        userId: USER_ID,
        feedback: 'Make the ending darker',
      },
      recording.client as SupabaseClient<Database>,
    );

    snapshot('story-refinement', {
      writes: flattenRows(recording.writes()),
      executor: executorCalls,
      result,
    });

    expect(result.success).toBe(true);
    expect(recording.writes().map((w) => `${w.table}:${w.op}`)).toEqual([
      'generation_jobs:update',
      'episodes:update',
      'generation_jobs:update',
    ]);
  });
});

describe('asset creation writes what it did before the core (FILM-1901)', () => {
  it('rows and prompt variables match the recorded fixture', async () => {
    const { processAssetCreation } = await import('../handlers/asset-creation');
    const recording = assetCreationClient();

    const result = await processAssetCreation(
      {
        accountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        episodeId: EPISODE_ID,
        userId: USER_ID,
      },
      recording.client as SupabaseClient<Database>,
    );

    snapshot('asset-creation', {
      writes: flattenRows(recording.writes()),
      executor: executorCalls,
      result,
    });

    expect(result.data.created).toBe(2);
    expect(result.data.linked).toBe(1);
  });
});
