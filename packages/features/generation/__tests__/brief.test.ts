import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import storyRefinement from '@kit/prompt-engine/prompts/story-generation/story-refinement.json';

import {
  BRIEF_TTL_MS,
  type PromptFile,
  type StageKey,
  buildBrief,
  checkWithSchema,
  getStage,
  registerStage,
  registeredStageKeys,
  singlePart,
  stageRegistry,
} from '../src';

const Output = z.object({
  title: z.string(),
  score: z.number().min(0).max(1),
  tags: z.array(z.string()).optional(),
});

describe('buildBrief (FILM-1901)', () => {
  const now = new Date('2026-10-03T10:00:00.000Z');

  const brief = buildBrief({
    stage: 'story_refinement',
    part: singlePart('story', 'The refined story'),
    prompt: storyRefinement as PromptFile,
    variables: {
      current_story: '{"title":"T"}',
      characters: 'Maya',
      locations: 'The deck',
      feedback: 'Darker ending',
      season_context: '',
      previous_episodes: '',
    },
    context: { episode: { id: 'e1', title: 'T' } },
    outputSchema: Output,
    constraints: { fullText: 'non-empty' },
    targetVersion: 4,
    rubricVariables: { title: 'T' },
    now,
  });

  it('renders the system layers, then the user prompt, with every variable filled', () => {
    expect(brief.instructions).toMatch(/^You are revising an existing story/);
    expect(brief.instructions).toContain('REVISION GUIDELINES');
    expect(brief.instructions).toContain('Darker ending');
    expect(brief.instructions).toContain('{"title":"T"}');
    expect(brief.instructions).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('names the prompt so a server executor can render it itself', () => {
    expect(brief.prompt).toEqual({
      slug: 'story-refinement',
      version: 1,
      variables: expect.objectContaining({ feedback: 'Darker ending' }),
    });
  });

  it('carries the output JSON Schema generated from the Zod schema', () => {
    expect(brief.outputSchema).toMatchObject({
      type: 'object',
      required: ['title', 'score'],
      properties: {
        title: { type: 'string' },
        score: { type: 'number', minimum: 0, maximum: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it("takes the example from the prompt's output.example_output", () => {
    expect(brief.example).toMatchObject({
      story: { title: 'The Last Signal' },
    });
  });

  it('renders the matching quality rubric as a self-check, with placeholders for the output', () => {
    expect(brief.qualityRubric).toContain('Story Title**: T');
    expect(brief.qualityRubric).toContain('<the story text you produce>');
    expect(brief.qualityRubric).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('carries constraints, the target version and a 30-minute expiry', () => {
    expect(brief.constraints).toEqual({ fullText: 'non-empty' });
    expect(brief.targetVersion).toBe(4);
    expect(brief.expiresAt).toBe(
      new Date(now.getTime() + BRIEF_TTL_MS).toISOString(),
    );
    expect(BRIEF_TTL_MS).toBe(30 * 60 * 1000);
  });

  it('refuses a prompt with a missing required variable, like the worker does', () => {
    expect(() =>
      buildBrief({
        stage: 'story_refinement',
        part: singlePart('story', 'x'),
        prompt: storyRefinement as PromptFile,
        variables: { current_story: '{}' },
        context: {},
        outputSchema: Output,
        targetVersion: null,
      }),
    ).toThrow(/Missing required variables.*feedback/);
  });
});

describe('checkWithSchema', () => {
  it('returns the parsed value when the output fits', () => {
    expect(checkWithSchema(Output, { title: 'T', score: 0.5 })).toEqual({
      ok: true,
      value: { title: 'T', score: 0.5 },
    });
  });

  it('turns every Zod issue into {path, code, message}', () => {
    const result = checkWithSchema(Output, {
      score: 3,
      tags: ['a', 2],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toEqual([
      { path: 'title', code: 'invalid_type', message: 'Required' },
      {
        path: 'score',
        code: 'too_big',
        message: expect.stringContaining('less than or equal to 1'),
      },
      {
        path: 'tags.1',
        code: 'invalid_type',
        message: 'Expected string, received number',
      },
    ]);
  });
});

describe('stage registry', () => {
  it('registers a stage once and finds it by key', () => {
    const stage = {
      key: 'publish_metadata' as const,
      targetType: 'publish' as const,
      targetSchema: z.object({ publishId: z.string() }),
      outputSchema: z.object({ title: z.string() }),
      parts: async () => [singlePart('metadata', 'Metadata')],
      prepare: async () => {
        throw new Error('not in this test');
      },
      check: async () => [],
      commit: async () => ({ status: 'committed' as const, data: null }),
    };

    // The real publish_metadata stage registers at import; stand it aside
    const real = stageRegistry.get('publish_metadata');
    stageRegistry.delete('publish_metadata');

    try {
      registerStage(stage);
      expect(getStage('publish_metadata')).toBe(stage);
      expect(registeredStageKeys()).toContain('publish_metadata');
      expect(() => registerStage({ ...stage })).toThrow(/already registered/);
    } finally {
      stageRegistry.delete('publish_metadata');
      if (real) stageRegistry.set('publish_metadata', real);
    }
  });

  it('names the registered stages when one is missing', () => {
    expect(() => getStage('not_a_stage' as StageKey)).toThrow(
      /not_a_stage is not registered/,
    );
  });
});
