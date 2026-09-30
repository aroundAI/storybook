import { describe, expect, it } from 'vitest';

import sceneShotGeneration from '../src/prompts/story-generation/scene-shot-generation.json';
import {
  SceneShotGenerationOutputSchema,
  SceneShotSchema,
} from '../src/schemas/story-generation-schemas';

const userPrompt = sceneShotGeneration.user_prompt;

const promptExample = JSON.parse(
  userPrompt.slice(userPrompt.indexOf('## OUTPUT JSON') + '## OUTPUT JSON'.length),
) as {
  shots: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const concreteExample: Record<string, unknown> & {
  shots: Array<Record<string, unknown>>;
} = {
  ...promptExample,
  shots: promptExample.shots.map((shot) => ({
    ...shot,
    shotType: 'medium',
    cameraDirection: 'tracking',
    transitionType: 'cut',
    frameStrategy: 'character_focus',
    primarySubject: { type: 'character', name: 'Mara' },
    metadata: {
      ...(shot.metadata as Record<string, unknown>),
      timeOfDay: 'golden-hour',
    },
  })),
  sceneHookType: 'reveal',
};

describe('SceneShotGenerationOutputSchema (FILM-304)', () => {
  it('parses the output the prompt asks for, with every field kept', () => {
    const parsed = SceneShotGenerationOutputSchema.parse(concreteExample);

    expect(parsed.sceneViralScore).toBe(8);
    expect(parsed.sceneHookType).toBe('reveal');
    expect(parsed.sceneStandaloneSummary).toBe(
      promptExample.sceneStandaloneSummary,
    );
    expect(parsed.shots[0]).toMatchObject({
      hookMoment: expect.any(String),
      emotionalTone: expect.any(String),
      transitionType: 'cut',
      frameStrategy: 'character_focus',
      primarySubject: { type: 'character', name: 'Mara' },
      firstFrameDescription: expect.any(String),
      lastFrameDescription: expect.any(String),
      locationArea: expect.any(String),
      locationEnvironmentDescription: expect.any(String),
    });
  });

  it('declares every top-level and per-shot key the prompt example emits', () => {
    const topLevel = Object.keys(SceneShotGenerationOutputSchema.shape);
    const perShot = Object.keys(SceneShotSchema.shape);

    expect(topLevel).toEqual(expect.arrayContaining(Object.keys(promptExample)));
    expect(perShot).toEqual(
      expect.arrayContaining(Object.keys(promptExample.shots[0]!)),
    );
  });

  it('requires the scene reel score the prompt demands', () => {
    const { sceneViralScore: _omitted, ...withoutScore } = concreteExample;

    expect(SceneShotGenerationOutputSchema.safeParse(withoutScore).success).toBe(
      false,
    );
  });

  it('accepts a reaction timeline event, which the prompt template allows', () => {
    const shot = concreteExample.shots[0]!;
    const withReaction = {
      ...concreteExample,
      shots: [
        {
          ...shot,
          veoPrompt: {
            ...(shot.veoPrompt as { timeline: unknown[] }),
            timeline: [
              {
                startTime: '00:00',
                endTime: '02:00',
                type: 'reaction',
                content: 'Mara flinches',
              },
            ],
          },
        },
      ],
    };

    expect(SceneShotGenerationOutputSchema.safeParse(withReaction).success).toBe(
      true,
    );
  });
});
