import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it, vi } from 'vitest';

import { processShotGeneration } from '../handlers/shot-generation';

/**
 * KB-120. The shot-generation job carries a shot-length range; the handler
 * hands it to the Shot Orchestrator, whose Shot Director holds every shot to
 * it (`packages/features/episodes/__tests__/shot-duration.test.ts`).
 */

const inputs = vi.hoisted(
  () => [] as Array<{ shotDuration?: { min: number; max: number } }>,
);

vi.mock('@kit/episodes/agent/shot-orchestrator', () => ({
  runShotOrchestrator: async (input: {
    shotDuration?: { min: number; max: number };
  }) => {
    inputs.push(input);
    return { success: false, error: 'stopped by the test', shots: [] };
  },
}));

vi.mock('../utils/job-tracking', () => ({
  markJobProcessing: async () => undefined,
  markJobCompleted: async () => undefined,
  markJobFailed: async () => undefined,
}));

vi.mock('../utils/context-builder', () => ({
  buildEpisodeContext: async () => ({
    characters: [],
    locations: [],
    recurringElements: [],
  }),
  formatCharactersForVeoPrompt: () => '',
  formatLocationsForVeoPrompt: () => '',
  formatRecurringElementsForPrompt: () => '',
}));

const supabase = {
  from: () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      single: async () => ({
        data: {
          id: 'e',
          title: 'E1',
          version: 1,
          screenplay_data: {
            scenes: [{ number: 1, heading: 'INT. OFFICE', description: 'x' }],
          },
          story_data: null,
          project: null,
        },
        error: null,
      }),
      then: (resolve: (value: { error: null }) => unknown) =>
        resolve({ error: null }),
    };
    return builder;
  },
} as unknown as SupabaseClient;

describe('shot generation (KB-120)', () => {
  it('hands the orchestrator the job’s shot-length range', async () => {
    await processShotGeneration(
      {
        accountId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        episodeId: '33333333-3333-4333-8333-333333333333',
        userId: '44444444-4444-4444-8444-444444444444',
        version: 1,
        shotDurationMin: 4,
        shotDurationMax: 6,
      },
      supabase,
    ).catch(() => undefined);

    expect(inputs[0]?.shotDuration).toEqual({ min: 4, max: 6 });
  });
});
