/**
 * Screenplay Director Skill
 *
 * Wraps screenplay generation as an agent-callable tool.
 * The Orchestrator calls this after the story has passed viral + continuity evaluation.
 *
 * Two export modes:
 * - createScreenplayDirectorSkill(context) — factory that pre-binds storyText + characters
 *   via closure so the LLM doesn't need to echo them as tool params (prevents truncation).
 * - screenplayDirectorSkill — static export for backward compat with the full orchestrator
 *   that passes storyText/characters via the LLM tool call.
 *
 * Returns:
 * - Structured screenplay with scenes, dialogue, and metadata
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

type ScreenplayResult = {
  screenplay: {
    title: string;
    scenes: Array<{
      number: number;
      heading: string;
      location: string;
      timeOfDay: string;
      description: string;
      action: string[];
      dialogue: Array<{
        character: string;
        text: string;
        parenthetical?: string;
      }>;
      estimatedDuration?: number;
      transitions?: string;
    }>;
    totalDialogueLines: number;
    estimatedDuration: number;
  };
};

const metadataParameters = z.object({
  characterNames: z
    .string()
    .describe('Comma-separated list of character names for reference'),
  locationNames: z
    .string()
    .describe('Comma-separated list of location names for reference'),
  genre: z.string().describe('Content genre'),
  targetAudience: z.string().describe('Target audience'),
  targetDurationSeconds: z
    .number()
    .describe('Target episode duration in seconds'),
  contentStyle: z
    .enum(['dialogue-heavy', 'balanced', 'action-heavy'])
    .default('dialogue-heavy'),
  sceneCountMin: z.number().describe('Minimum number of scenes'),
  sceneCountMax: z.number().describe('Maximum number of scenes'),
  dialogueLinesPerSceneMin: z
    .number()
    .describe('Minimum dialogue lines per scene'),
  dialogueLinesPerSceneMax: z
    .number()
    .describe('Maximum dialogue lines per scene'),
});

async function executeScreenplayGeneration(
  storyText: string,
  characters: string,
  recurringElements: string | undefined,
  params: z.infer<typeof metadataParameters>,
) {
  const {
    characterNames,
    locationNames,
    genre,
    targetAudience,
    targetDurationSeconds,
    contentStyle,
    sceneCountMin,
    sceneCountMax,
    dialogueLinesPerSceneMin,
    dialogueLinesPerSceneMax,
  } = params;

  const { executeLLM } = await import('@kit/prompt-engine/server');

  const minutesDuration = Math.round(targetDurationSeconds / 60);
  const avgSceneDuration = Math.round(
    targetDurationSeconds / ((sceneCountMin + sceneCountMax) / 2),
  );

  console.log(
    `[Screenplay Director] Scaling targets: ${sceneCountMin}–${sceneCountMax} scenes, ` +
      `${dialogueLinesPerSceneMin}–${dialogueLinesPerSceneMax} lines/scene, ` +
      `avg ${avgSceneDuration}s/scene, ${minutesDuration} min target`,
  );

  const result = await executeLLM<ScreenplayResult>({
    templateSlug: 'screenplay-conversion',
    variables: {
      story: storyText,
      characters: characters || 'No characters defined.',
      character_names: characterNames,
      location_names: locationNames,
      target_duration: targetDurationSeconds,
      duration_description: `${minutesDuration} minutes`,
      content_style: contentStyle,
      scene_count_min: sceneCountMin,
      scene_count_max: sceneCountMax,
      avg_scene_duration: avgSceneDuration,
      dialogue_lines_per_scene_min: dialogueLinesPerSceneMin,
      dialogue_lines_per_scene_max: dialogueLinesPerSceneMax,
      total_dialogue_lines_min: sceneCountMin * dialogueLinesPerSceneMin,
      total_dialogue_lines_max: sceneCountMax * dialogueLinesPerSceneMax,
      style: contentStyle === 'dialogue-heavy' ? 'natural' : 'visual',
      genre: genre,
      target_audience: targetAudience,
      recurring_element: recurringElements ?? '',
    },
    context: {
      name: 'agent.screenplayDirector.generateScreenplay',
      accountId: '',
    },
  });

  const { screenplay } = result.data;

  return {
    title: screenplay.title,
    scenes: screenplay.scenes,
    totalDialogueLines: screenplay.totalDialogueLines,
    estimatedDuration: screenplay.estimatedDuration,
    sceneCount: screenplay.scenes.length,
    summary: `Screenplay "${screenplay.title}" — ${screenplay.scenes.length} scenes, ${screenplay.totalDialogueLines} dialogue lines, ~${minutesDuration} min`,
  };
}

// ---------------------------------------------------------------------------
// Factory export — pre-binds storyText + characters via closure
// Used by screenplay-orchestrator.ts where context is known upfront.
// ---------------------------------------------------------------------------

interface ScreenplayDirectorContext {
  storyText: string;
  characters: string;
  recurringElements?: string;
}

export function createScreenplayDirectorSkill(
  context: ScreenplayDirectorContext,
): Skill {
  const generateScreenplayTool = createTool({
    name: 'generateScreenplay',
    description:
      'Converts a finished story into a structured screenplay with scenes, scene headings, action lines, and dialogue. The story text and character context are already pre-loaded — do NOT pass them as parameters.',
    parameters: metadataParameters,
    execute: async (params) => {
      try {
        return toolSuccess(
          await executeScreenplayGeneration(
            context.storyText,
            context.characters,
            context.recurringElements,
            params,
          ),
        );
      } catch (error) {
        return toolError(
          `Screenplay Director failed: ${(error as Error).message}`,
        );
      }
    },

    // OPT-2: Drop full scenes array from history, keep counts
    summarizeResult: (result) => {
      if (!result.success || !result.data) return result;
      const d = result.data as Record<string, unknown>;
      return {
        success: true,
        title: d.title,
        sceneCount: d.sceneCount,
        totalDialogueLines: d.totalDialogueLines,
        estimatedDuration: d.estimatedDuration,
        summary: d.summary,
      };
    },
  });

  return {
    name: 'screenplay-director',
    description:
      'Converts a finalized story into a structured screenplay with scenes, action lines, and dialogue. Call only after the story has passed viral quality evaluation.',
    tools: [generateScreenplayTool],
    contextPrompt: `You are the Screenplay Director — a specialist in visual storytelling format.

You translate finished narrative prose into scene-by-scene screenplay format:
- Each scene has a heading (INT./EXT. LOCATION - TIME), action lines, and dialogue
- Dialogue is sharp and character-driven — each line reveals personality or advances plot
- Character names in dialogue MUST exactly match the locked character names provided
- Scene descriptions are visual and concrete — what the camera sees, not what characters feel internally`,
    instructions: `1. Call generateScreenplay with the metadata parameters (genre, sceneCount, etc.)
2. The story text and characters context are already pre-loaded — do NOT pass them as parameters
3. Return the screenplay title, scenes array, and scene count to the Orchestrator
4. The Orchestrator will then pass scenes to Reel Scout and Shot Director`,
  };
}

// ---------------------------------------------------------------------------
// Static export — backward compat for the full orchestrator (orchestrator.ts)
// that passes storyText/characters via the LLM tool call.
// ---------------------------------------------------------------------------

const generateScreenplayToolStatic = createTool({
  name: 'generateScreenplay',
  description:
    'Converts a finished story into a structured screenplay with scenes, scene headings, action lines, and dialogue. Call this after the story has passed viral quality evaluation (score ≥ 0.65).',
  parameters: z
    .object({
      storyText: z
        .string()
        .describe('The full finalized story text from the Story Director'),
      characters: z
        .string()
        .describe(
          'Pre-formatted LOCKED IDENTITY character block from formatCharactersForPrompt. Must be passed verbatim — do not summarize.',
        ),
    })
    .merge(metadataParameters),
  execute: async ({ storyText, characters, ...params }) => {
    try {
      return toolSuccess(
        await executeScreenplayGeneration(
          storyText,
          characters,
          undefined,
          params,
        ),
      );
    } catch (error) {
      return toolError(
        `Screenplay Director failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Drop full scenes array from history, keep counts
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      title: d.title,
      sceneCount: d.sceneCount,
      totalDialogueLines: d.totalDialogueLines,
      estimatedDuration: d.estimatedDuration,
      summary: d.summary,
    };
  },
});

export const screenplayDirectorSkill: Skill = {
  name: 'screenplay-director',
  description:
    'Converts a finalized story into a structured screenplay with scenes, action lines, and dialogue. Call only after the story has passed viral quality evaluation.',
  tools: [generateScreenplayToolStatic],
  contextPrompt: `You are the Screenplay Director — a specialist in visual storytelling format.

You translate finished narrative prose into scene-by-scene screenplay format:
- Each scene has a heading (INT./EXT. LOCATION - TIME), action lines, and dialogue
- Dialogue is sharp and character-driven — each line reveals personality or advances plot
- Character names in dialogue MUST exactly match the locked character names provided
- Scene descriptions are visual and concrete — what the camera sees, not what characters feel internally`,
  instructions: `1. Call generateScreenplay with the finalized storyText from the Story Director
2. Pass the characters context block EXACTLY as received — do not summarize or abbreviate it
3. Return the screenplay title, scenes array, and scene count to the Orchestrator
4. The Orchestrator will then pass scenes to Reel Scout and Shot Director`,
};
