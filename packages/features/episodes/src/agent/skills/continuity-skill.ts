/**
 * Continuity Validation Skill
 *
 * Wraps the existing canon system (memory context builder + continuity validator)
 * as agent-callable tools. This is the primary mechanism for ensuring
 * narrative consistency across episodes.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

/**
 * Tool: Build Memory Context
 *
 * Loads canon data (immutable events, character states, narrative threads,
 * world state, episode summaries) into a token-budgeted memory context.
 */
const buildMemoryContextTool = createTool({
  name: 'buildMemoryContext',
  description:
    'Loads project canon data (immutable events, character states, narrative threads, world state, episode summaries) into a structured memory context for continuity checking. Call this FIRST before checking continuity.',
  parameters: z.object({
    projectId: z.string().describe('The project ID to load canon data for'),
    episodeNumber: z
      .number()
      .describe('Current episode number for memory horizon calculation'),
    memoryHorizon: z
      .number()
      .optional()
      .describe('Number of past episodes to include (default: 10)'),
  }),
  execute: async ({ projectId, episodeNumber, memoryHorizon }) => {
    try {
      const { buildMemoryContext } = await import(
        '../../lib/canon/memory-context-builder'
      );

      const context = await buildMemoryContext({
        projectId,
        episodeNumber,
        memoryHorizon: memoryHorizon ?? 10,
      });

      return toolSuccess({
        summary: `Loaded memory context: ${context.immutableEvents.length} immutable events, ${context.characterStates.length} characters, ${context.activeThreads.length} threads, ${context.recentSummaries.length} summaries`,
        immutableEvents: context.immutableEvents.map(
          (e: {
            eventKey: string;
            eventType: string;
            description: string;
          }) => ({
            eventKey: e.eventKey,
            type: e.eventType,
            description: e.description,
          }),
        ),
        characterStates: context.characterStates.map((c) => ({
          name: c.characterName,
          constraints: c.constraints,
          arc: c.arc ?? '',
        })),
        activeThreads: context.activeThreads.map(
          (t: { threadName: string; status: string; threadType: string }) => ({
            name: t.threadName,
            status: t.status,
            type: t.threadType,
          }),
        ),
        worldState: context.worldState
          ? {
              location: context.worldState.location,
              activeConflicts: context.worldState.activeConflicts,
            }
          : null,
        tokensUsed: context.metadata.totalTokensUsed,
      });
    } catch (error) {
      return toolError(
        `Failed to build memory context: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Drop full event/thread data from history, keep counts + character names
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const chars = d.characterStates as Array<{ name: string }> | undefined;
    return {
      success: true,
      summary: d.summary,
      characterNames: chars?.map((c) => c.name) ?? [],
      tokensUsed: d.tokensUsed,
    };
  },
});

/**
 * Tool: Check Plot Continuity
 *
 * Validates a plot skeleton against the established canon.
 * Runs all 9 validation rules (CANON_001-009).
 */
const checkContinuityTool = createTool({
  name: 'checkContinuity',
  description:
    'Validates a plot skeleton against established canon rules. Checks for resurrection failures, state reversals, knowledge violations, world contradictions, and more. Returns violations that MUST be fixed.',
  parameters: z.object({
    plotSkeleton: z.object({
      premise: z.string(),
      episodeNumber: z.number(),
      characters: z.array(
        z.object({
          characterId: z.string(),
          name: z.string(),
          role: z.string(),
          emotionalArc: z.string().optional(),
        }),
      ),
      scenes: z.array(
        z.object({
          sceneNumber: z.number(),
          summary: z.string(),
          location: z.string().optional(),
          charactersPresent: z.array(z.string()),
          keyEvents: z.array(z.string()).optional(),
        }),
      ),
    }),
    projectId: z.string(),
    episodeNumber: z.number(),
  }),
  execute: async ({ plotSkeleton, projectId, episodeNumber }) => {
    try {
      const { buildMemoryContext } = await import(
        '../../lib/canon/memory-context-builder'
      );
      const { validatePlotSkeleton } = await import(
        '../../lib/canon/continuity-validator'
      );

      const memoryContext = await buildMemoryContext({
        projectId,
        episodeNumber,
      });

      const result = validatePlotSkeleton(plotSkeleton, memoryContext);

      return toolSuccess({
        valid: result.valid,
        summary: result.summary,
        violations: result.violations.map((v) => ({
          code: v.code,
          severity: v.severity,
          message: v.message,
          suggestion: v.suggestion ?? '',
        })),
        passedRules: result.passedRules,
      });
    } catch (error) {
      return toolError(`Continuity check failed: ${(error as Error).message}`);
    }
  },
});

/**
 * Tool: Check Scene Continuity
 *
 * Validates individual scene blocks against canon.
 * Used at the SCREENPLAY checkpoint.
 */
const checkSceneContinuityTool = createTool({
  name: 'checkSceneContinuity',
  description:
    'Validates screenplay scene blocks against established canon. Use at the screenplay stage to ensure scene-level consistency.',
  parameters: z.object({
    scenes: z.array(
      z.object({
        sceneNumber: z.number(),
        content: z.string(),
      }),
    ),
    projectId: z.string(),
    episodeNumber: z.number(),
  }),
  execute: async ({ scenes, projectId, episodeNumber }) => {
    try {
      const { buildMemoryContext } = await import(
        '../../lib/canon/memory-context-builder'
      );
      const { validateSceneBlocks } = await import(
        '../../lib/canon/continuity-validator'
      );

      const memoryContext = await buildMemoryContext({
        projectId,
        episodeNumber,
      });

      const result = validateSceneBlocks(scenes, memoryContext);

      return toolSuccess({
        valid: result.valid,
        summary: result.summary,
        violations: result.violations.map((v) => ({
          code: v.code,
          severity: v.severity,
          message: v.message,
          suggestion: v.suggestion ?? '',
        })),
      });
    } catch (error) {
      return toolError(
        `Scene continuity check failed: ${(error as Error).message}`,
      );
    }
  },
});

/**
 * Continuity Validation Skill
 *
 * Bundles canon tools with context and instructions
 * for the agent to use during content generation.
 */
export const continuitySkill: Skill = {
  name: 'continuity-validation',
  description:
    'Validates content against established canon and narrative continuity. Prevents dead characters from appearing alive, state reversals, knowledge violations, and world contradictions.',
  tools: [
    buildMemoryContextTool,
    checkContinuityTool,
    checkSceneContinuityTool,
  ],
  contextPrompt: `You have access to a continuity validation system that enforces narrative rules:
- CANON_001: Dead characters cannot appear alive (HARD FAIL)
- CANON_002: Character state changes cannot be reversed without authorization
- CANON_003: Characters cannot know information they haven't learned
- CANON_005: Content cannot contradict established world facts
- CANON_006: References must point to existing events/characters
- CANON_007: Narrative threads must connect (setups need payoffs)

Violations with severity "error" MUST be fixed before proceeding.
Violations with severity "warning" should be addressed if possible.`,
  instructions: `1. Call buildMemoryContext first to load canon data for the project
2. After generating narrative content, call checkContinuity with the plot skeleton
3. If violations with severity=error exist, revise the content to fix them
4. Re-check continuity after revisions
5. Only proceed to the next stage when checkContinuity returns valid=true`,
};
