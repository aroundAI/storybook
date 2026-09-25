import 'server-only';

/**
 * Agent-Orchestrated Story Generation Action
 *
 * Uses @kit/agent with continuity + quality skills to generate a story with:
 * 1. Memory context loading (builds from canon)
 * 2. Story generation via executeLLM
 * 3. Continuity validation (with auto-retry if violations found)
 * 4. Final answer with validated story
 *
 * This adds an agentic self-correction loop on top of the existing linear pipeline.
 */
import { z } from 'zod';

import { createTool, runAgent, toolError, toolSuccess } from '@kit/agent';
import { createContinuitySkill } from '@kit/episodes/skills';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// =============================================================================
// TOOLS
// =============================================================================

/**
 * Tool: Generate Story
 * Calls the story-generation prompt template via executeLLM.
 */
const generateStoryTool = createTool({
  name: 'generateStory',
  description:
    'Generates a full story from a logline and context. Returns story text, act breakdown, characters, and themes.',
  parameters: z.object({
    title: z.string().describe('Episode title'),
    logline: z.string().describe('Episode logline / premise'),
    targetDurationSeconds: z.number().describe('Target duration in seconds'),
    contentStyle: z
      .enum(['dialogue-heavy', 'balanced', 'action-heavy'])
      .describe('Content style'),
    canonContext: z.string().optional().describe('Canon/memory context string'),
  }),
  execute: async (params) => {
    const {
      title,
      logline,
      targetDurationSeconds,
      contentStyle,
      canonContext,
    } = params;
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const minutesDuration = Math.round(targetDurationSeconds / 60);
      const wordCountMin = minutesDuration * 120;
      const wordCountMax = minutesDuration * 180;
      const sceneCountMin = Math.max(3, Math.floor(minutesDuration / 1.5));
      const sceneCountMax = Math.max(5, Math.ceil(minutesDuration));

      const result = await executeLLM({
        templateSlug: 'story-generation',
        variables: {
          title,
          logline,
          premise: logline,
          target_duration: targetDurationSeconds,
          duration_description: `${minutesDuration} minutes`,
          word_count_min: wordCountMin,
          word_count_max: wordCountMax,
          estimated_scene_count_min: sceneCountMin,
          estimated_scene_count_max: sceneCountMax,
          content_style: contentStyle,
          characters: '',
          locations: '',
          season_context: '',
          previous_episodes: '',
          genre: '',
          target_audience: '',
          visual_style: '',
          recurring_element: '',
          canon_context: canonContext ?? '',
          ideation_themes: '',
          ideation_hook: '',
          visual_direction: '',
          viral_goals: '',
          verified_facts: '',
          plot_beats: '',
        },
        context: { name: 'agent.generateStory', accountId: '' },
      });

      return toolSuccess(result.data);
    } catch (error) {
      return toolError(`Story generation failed: ${(error as Error).message}`);
    }
  },
});

// =============================================================================
// TYPES
// =============================================================================

export interface AgentStoryInput {
  episodeId: string;
  projectId: string;
  episodeNumber: number;
  title: string;
  logline: string;
  targetDurationSeconds: number;
  contentStyle: 'dialogue-heavy' | 'balanced' | 'action-heavy';
}

export interface AgentStoryResult {
  success: boolean;
  story: unknown;
  steps: number;
  budget: {
    totalTokens: number;
    totalCostUSD: number;
    totalLatencyMs: number;
  };
  error?: string;
}

// =============================================================================
// AGENT ACTION
// =============================================================================

/**
 * Runs agent-orchestrated story generation with continuity validation.
 *
 * @example
 * ```typescript
 * const result = await runAgentStoryGeneration({
 *   episodeId: 'ep-123',
 *   projectId: 'proj-456',
 *   episodeNumber: 3,
 *   title: 'The Turning Point',
 *   logline: 'Maria discovers the truth about her sister.',
 *   targetDurationSeconds: 300,
 *   contentStyle: 'dialogue-heavy',
 * });
 * ```
 */
/**
 * @deprecated This standalone agent path does not receive recurringElements from the project.
 * Use the production pipeline (story-generation handler → story-orchestrator) instead.
 */
export async function runAgentStoryGeneration(
  input: AgentStoryInput,
): Promise<AgentStoryResult> {
  const logger = await getLogger();

  logger.info(
    { episodeId: input.episodeId, projectId: input.projectId },
    '[AgentStory] Starting agent-orchestrated story generation',
  );

  const result = await runAgent<unknown>(
    {
      name: 'story-generator',
      systemPrompt: `You are an expert story generator and canon compliance officer.

Your task is to generate a high-quality, canon-compliant story for Episode ${input.episodeNumber}.

## Episode Brief
- Title: ${input.title}
- Logline: ${input.logline}
- Target Duration: ${Math.round(input.targetDurationSeconds / 60)} minutes
- Style: ${input.contentStyle}

## Workflow
1. Call buildMemoryContext(episodeNumber=${input.episodeNumber}) to load the project canon
2. Call generateStory with the title, logline, duration, and the memory context summary
3. Call checkContinuity with a plot skeleton derived from the story scenes and characters
4. If violations exist with severity=error, call generateStory again — include violation corrections in the canonContext parameter
5. Once continuity is valid (or after 2 attempts), provide the final story as your answer`,

      tools: [generateStoryTool],

      // Apply continuity skill: adds buildMemoryContext, checkContinuity, checkSceneContinuity
      skills: [
        createContinuitySkill({
          client: getSupabaseServerClient(),
          projectId: input.projectId,
        }),
      ],

      maxSteps: 8,
      budgetLimits: {
        maxTotalTokens: 80000,
        maxCostUSD: 0.5,
        maxLatencyMs: 180000,
      },
    },
    {
      userPrompt: `Generate a canon-compliant story.
Project ID: ${input.projectId}
Episode Number: ${input.episodeNumber}`,
    },
    { accountId: input.projectId },
  );

  logger.info(
    {
      episodeId: input.episodeId,
      success: result.success,
      steps: result.steps.length,
    },
    '[AgentStory] Agent run complete',
  );

  return {
    success: result.success,
    story: result.data,
    steps: result.steps.length,
    budget: result.budget,
    error: result.error,
  };
}
