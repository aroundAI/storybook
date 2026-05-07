/**
 * Content Generation Skill
 *
 * Wraps existing executeLLM prompt templates as agent-callable tools.
 * Each tool calls a specific prompt template from @kit/prompt-engine.
 */
import { z } from 'zod';

import { createTool, toolError, toolSuccess } from '../tool';
import type { Skill } from '../types';

// =============================================================================
// CONTENT GENERATION TOOLS
// =============================================================================

/**
 * Tool: Generate Story
 *
 * Calls the story-generation prompt template via executeLLM.
 */
const generateStoryTool = createTool({
  name: 'generateStory',
  description:
    'Generates a story using the story-generation prompt template. Produces narrative content with scenes, characters, and dialogue.',
  parameters: z.object({
    concept: z.string().describe('The story concept or premise'),
    targetDuration: z
      .number()
      .optional()
      .describe('Target duration in seconds'),
    genre: z
      .string()
      .optional()
      .describe('Story genre (e.g., thriller, comedy, drama)'),
    tone: z
      .string()
      .optional()
      .describe('Story tone (e.g., dark, lighthearted, suspenseful)'),
    additionalContext: z
      .string()
      .optional()
      .describe(
        'Additional context like character descriptions, world-building, etc.',
      ),
  }),
  execute: async (
    { concept, targetDuration, genre, tone, additionalContext },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM({
        templateSlug: 'story-generation/story-generation',
        variables: {
          concept,
          target_duration: targetDuration?.toString() ?? '300',
          genre: genre ?? 'drama',
          tone: tone ?? 'engaging',
          additional_context: additionalContext ?? '',
        },
        context: {
          name: 'agent.generateStory',
          accountId: context.accountId,
        },
      });

      return toolSuccess(result.data);
    } catch (error) {
      return toolError(`Story generation failed: ${(error as Error).message}`);
    }
  },
});

/**
 * Tool: Generate Screenplay
 *
 * Converts a story into screenplay format via executeLLM.
 */
const generateScreenplayTool = createTool({
  name: 'generateScreenplay',
  description:
    'Converts a story into screenplay format with scenes, dialogue, stage directions, and timing.',
  parameters: z.object({
    story: z.string().describe('The story content to convert to screenplay'),
    targetDuration: z
      .number()
      .optional()
      .describe('Target duration in seconds'),
  }),
  execute: async ({ story, targetDuration }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM({
        templateSlug: 'story-generation/screenplay-conversion',
        variables: {
          story_content: story,
          target_duration: targetDuration?.toString() ?? '300',
        },
        context: {
          name: 'agent.generateScreenplay',
          accountId: context.accountId,
        },
      });

      return toolSuccess(result.data);
    } catch (error) {
      return toolError(
        `Screenplay generation failed: ${(error as Error).message}`,
      );
    }
  },
});

/**
 * Tool: Generate Shots
 *
 * Generates VEO 3.1 shot prompts for a scene via executeLLM.
 */
const generateShotsTool = createTool({
  name: 'generateShots',
  description:
    'Generates VEO 3.1 optimized shot prompts for a scene, including subject, action, scene, style, dialogue, sounds, and negative components.',
  parameters: z.object({
    sceneContent: z
      .string()
      .describe('The scene content to generate shots for'),
    sceneNumber: z.number().describe('Scene number in the episode'),
    characterContext: z
      .string()
      .optional()
      .describe('Character descriptions for visual consistency'),
  }),
  execute: async ({ sceneContent, sceneNumber, characterContext }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM({
        templateSlug: 'story-generation/scene-shot-generation',
        variables: {
          scene_content: sceneContent,
          scene_number: sceneNumber.toString(),
          character_context: characterContext ?? '',
        },
        context: {
          name: 'agent.generateShots',
          accountId: context.accountId,
        },
      });

      return toolSuccess(result.data);
    } catch (error) {
      return toolError(`Shot generation failed: ${(error as Error).message}`);
    }
  },
});

/**
 * Tool: Generate Audio Cues
 *
 * Extracts audio cues from a screenplay scene.
 */
const generateAudioCuesTool = createTool({
  name: 'generateAudioCues',
  description:
    'Extracts audio cues (sound effects, ambient sounds, music cues) from a screenplay scene.',
  parameters: z.object({
    sceneContent: z
      .string()
      .describe('The scene content to extract audio cues from'),
    sceneNumber: z.number().describe('Scene number'),
  }),
  execute: async ({ sceneContent, sceneNumber }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM({
        templateSlug: 'story-generation/audio-cue-generation',
        variables: {
          scene_content: sceneContent,
          scene_number: sceneNumber.toString(),
        },
        context: {
          name: 'agent.generateAudioCues',
          accountId: context.accountId,
        },
      });

      return toolSuccess(result.data);
    } catch (error) {
      return toolError(
        `Audio cue generation failed: ${(error as Error).message}`,
      );
    }
  },
});

// =============================================================================
// SKILL EXPORT
// =============================================================================

/**
 * Content Generation Skill
 *
 * Provides content generation capabilities by wrapping existing
 * executeLLM prompt templates as agent-callable tools.
 */
export const contentGenerationSkill: Skill = {
  name: 'content-generation',
  description:
    'Generates stories, screenplays, shot lists, and audio cues using the established prompt templates.',
  tools: [
    generateStoryTool,
    generateScreenplayTool,
    generateShotsTool,
    generateAudioCuesTool,
  ],
  contextPrompt: `You can generate narrative content at multiple stages:
- Story: Full narrative from a concept
- Screenplay: Scene-by-scene screenplay from a story
- Shots: VEO 3.1 optimized shot prompts from screenplay scenes
- Audio Cues: Sound effects and music cues from scenes

Each generation uses specialized prompt templates optimized for that content type.`,
};
