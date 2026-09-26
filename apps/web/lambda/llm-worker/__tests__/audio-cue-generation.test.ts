import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processAudioCueGeneration } from '../handlers/audio-cue-generation';

/**
 * KB-92: a cue takes its scene from the shot it starts on, and a shot's scene
 * is optional. A cue on a sceneless shot is saved with no scene, beside every
 * other cue; it is not dropped and not given a made-up scene 0.
 *
 * `audio_cues.scene_number` accepting null is proven against the database by
 * `supabase/tests/database/audio-cue-scene-optional.test.sql`; this test
 * guards the handler's half, which a "skip it" or `?? 0` fix would change.
 */

type Row = Record<string, unknown>;

const EPISODE = '33333333-3333-4333-8333-333333333333';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

vi.mock('../utils/job-tracking', () => ({
  markJobProcessing: vi.fn(),
  markJobCompleted: vi.fn(),
  markJobFailed: vi.fn(),
}));

vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: async () => ({
    success: true,
    orchestratorSteps: 1,
    coveragePercent: 100,
    cues: [1, 2, 3].map((seq) => ({
      type: 'sfx',
      prompt: `cue on shot ${seq}`,
      startShotSequence: seq,
      startOffsetInShot: 0,
      durationSeconds: 2,
    })),
  }),
}));

function fakeClient(shots: Row[]) {
  const inserted: Row[][] = [];
  const client = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => Promise.resolve({ data: shots, error: null }),
        insert(rows: Row[]) {
          if (table === 'audio_cues') inserted.push(rows);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    inserted,
  };
}

function shot(sequence: number, scene: number | null): Row {
  return {
    sequence_number: sequence,
    scene_number: scene,
    duration_seconds: 4,
    scene_description: `shot ${sequence}`,
    prompt: '',
    generation_metadata: null,
  };
}

describe('processAudioCueGeneration (KB-92)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a cue on a sceneless shot with no scene, beside the others', async () => {
    const { client, inserted } = fakeClient([
      shot(1, 1),
      shot(2, null),
      shot(3, 2),
    ]);

    const result = await processAudioCueGeneration(
      { episodeId: EPISODE, projectId: PROJECT, accountId: ACCOUNT },
      client,
    );

    expect(result).toEqual({ success: true, cuesCreated: 3 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.map((row) => [row.prompt, row.scene_number])).toEqual([
      ['cue on shot 1', 1],
      ['cue on shot 2', null],
      ['cue on shot 3', 2],
    ]);
  });
});
