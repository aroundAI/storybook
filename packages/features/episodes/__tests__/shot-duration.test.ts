import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import { reelNoteFor } from '@kit/prompt-engine/schemas';

import { shotDirectorSkill } from '../src/agent/skills/shot-director-skill';

/**
 * KB-120. Shot generation took a shot-length range (`shotDurationMin`,
 * `shotDurationMax`) and dropped it: no handler read it, and the prompt
 * hard-coded "MAX 8 seconds". The range now travels with the job, reaches
 * the prompt, and every generated shot is held to it.
 */

const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const durations = vi.hoisted(() => ({ values: [12, 2, 6] }));

vi.mock('@kit/ai-gateway', () => ({
  executeLLM: async (config: { variables: Record<string, unknown> }) => {
    calls.push(config.variables);
    return {
      data: {
        sceneSummary: 'A scene',
        shots: durations.values.map((duration, index) => ({
          shotNumber: index + 1,
          shotType: 'medium',
          cameraDirection: 'static',
          description: `Shot ${index + 1}`,
          duration,
          characters: [],
          veoPrompt: {
            shotLine: '',
            audio: '',
            style: '',
            avoid: '',
            fullPrompt: '',
          },
          metadata: { location: 'Office', timeOfDay: 'day' },
        })),
      },
    };
  },
}));

const params = {
  episodeTitle: 'E1',
  genre: 'drama',
  targetAudience: 'general',
  visualStyle: 'cinematic',
  characters: '',
  locations: '',
  scenes: [{ number: 1, heading: 'INT. OFFICE', dialogue: [] }],
  reelCandidateScenes: [],
  tone: 'balanced',
};

async function generate(context: Record<string, unknown>) {
  const tool = shotDirectorSkill.tools[0]!;
  const result = (await tool.execute(params, {
    accountId: '11111111-1111-4111-8111-111111111111',
    ...context,
  })) as { success: boolean; data?: { shots: Array<{ duration: number }> } };

  expect(result.success).toBe(true);
  return result.data!.shots.map((shot) => shot.duration);
}

beforeEach(() => {
  calls.length = 0;
});

describe('shot length (KB-120)', () => {
  it('asks the prompt for the job’s range', async () => {
    await generate({ _shotDuration: { min: 4, max: 6 } });

    expect(calls[0]).toMatchObject({
      shot_duration_min: 4,
      shot_duration_max: 6,
    });
  });

  it('holds every generated shot to that range', async () => {
    expect(await generate({ _shotDuration: { min: 4, max: 6 } })).toEqual([
      6, 4, 6,
    ]);
  });

  it('uses 5–8 seconds when the job names no range', async () => {
    expect(await generate({})).toEqual([8, 5, 6]);
    expect(calls[0]).toMatchObject({
      shot_duration_min: 5,
      shot_duration_max: 8,
    });
  });

  it('carries the range in the queued job, refusing one that is upside down', () => {
    const job = {
      accountId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      episodeId: '33333333-3333-4333-8333-333333333333',
      userId: '44444444-4444-4444-8444-444444444444',
      version: 1,
    };

    expect(
      parseLlmJobPayload('shot-generation', {
        ...job,
        shotDurationMin: 4,
        shotDurationMax: 6,
      }),
    ).toMatchObject({ shotDurationMin: 4, shotDurationMax: 6 });

    expect(() =>
      parseLlmJobPayload('shot-generation', {
        ...job,
        shotDurationMin: 8,
        shotDurationMax: 5,
      }),
    ).toThrow(/shotDurationMax: must not be less than shotDurationMin/);
  });
});

describe('the Reel Scout note (KB-178)', () => {
  it('sends the priority note for a Reel candidate, and an empty one otherwise', async () => {
    const tool = shotDirectorSkill.tools[0]!;
    const context = { accountId: '11111111-1111-4111-8111-111111111111' };

    await tool.execute({ ...params, reelCandidateScenes: [1] }, context);
    await tool.execute(params, context);

    expect(calls[0]!.reel_note).toBe(reelNoteFor(1, [1]));
    expect(calls[0]!.reel_note).toContain('PRIORITY: This scene is a Reel');
    expect(calls[1]!.reel_note).toBe('');
  });
});
