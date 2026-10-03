/**
 * Shot Director Skill
 *
 * Wraps shot generation as an agent-callable tool.
 * The Orchestrator calls this after the Reel Scout has identified
 * candidate scenes, so the Shot Director can prioritize hook-optimized
 * shot compositions for those scenes.
 *
 * Accepts:
 * - Screenplay scenes from the Screenplay Director
 * - VEO-formatted character context (formatCharactersForVeoPrompt)
 * - Reel candidate scene numbers from Reel Scout (for priority treatment)
 *
 * Returns:
 * - Structured shot list ready for DB insertion
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';
import {
  DEFAULT_SHOT_DURATION,
  clampShotDuration,
} from '@kit/prompt-engine/llm-job-payloads';
import { reelNoteFor } from '@kit/prompt-engine/schemas';

const ShotDurationContextSchema = z.object({
  min: z.number(),
  max: z.number(),
});

/** The range the job asked for, or the default when none came with it. */
function shotDurationFrom(value: unknown): { min: number; max: number } {
  const parsed = ShotDurationContextSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_SHOT_DURATION };
}

const generateShotsTool = createTool({
  name: 'generateShots',
  description:
    'Generates a VEO 3.1 optimized shot list for all screenplay scenes. Processes scenes in parallel. Accepts reelCandidateScenes from Reel Scout to prioritize hook-optimized shot compositions for those scenes.',
  parameters: z.object({
    episodeTitle: z.string().describe('Episode title'),
    genre: z.string().describe('Content genre'),
    targetAudience: z.string().describe('Target audience'),
    visualStyle: z.string().describe('Visual/aesthetic style of the project'),
    characters: z
      .string()
      .describe(
        'VEO 3.1 formatted character context from formatCharactersForVeoPrompt — includes 15+ physical attributes per character.',
      ),
    locations: z.string().describe('VEO 3.1 formatted location context'),
    scenes: z
      .array(
        z.object({
          number: z.number(),
          heading: z.string().optional(),
          location: z.string().optional(),
          timeOfDay: z.string().optional(),
          description: z.string().optional(),
          action: z.array(z.string()).optional(),
          dialogue: z
            .array(
              z.object({
                character: z.string(),
                text: z.string(),
                parenthetical: z.string().optional(),
              }),
            )
            .optional(),
          estimatedDuration: z.number().optional(),
        }),
      )
      .describe('All screenplay scenes to generate shots for'),
    reelCandidateScenes: z
      .array(z.number())
      .describe(
        'Scene numbers identified by Reel Scout as Reel candidates. Shot Director will prioritize hook/visual storytelling in these scenes.',
      ),
    tone: z.string().default('balanced').describe('Narrative tone'),
    recurringElements: z
      .string()
      .optional()
      .describe(
        'Pre-formatted recurring story elements block. Shots for recurring scenes should use consistent framing and composition.',
      ),
  }),
  execute: async (
    {
      episodeTitle,
      genre,
      targetAudience,
      visualStyle,
      characters,
      locations,
      scenes,
      reelCandidateScenes,
      tone,
      recurringElements,
    },
    context,
  ) => {
    console.log(
      `[Shot Director] Starting shot generation for "${episodeTitle}". ` +
        `Scenes: ${scenes.length}, Reel candidates: ${reelCandidateScenes.join(', ') || 'none'}`,
    );

    try {
      const { executeLLM } = await import('@kit/ai-gateway');

      // The job's shot length, not the LLM's choice of tool arguments (KB-120)
      const shotDuration = shotDurationFrom(context?._shotDuration);

      // Merge LLM-provided sparse scenes with full context data
      const fullScenes = context?._scenesContext ?? scenes;
      const mergedScenes = scenes.map((s) => {
        const full = (fullScenes as typeof scenes).find(
          (f) => f.number === s.number,
        );
        return full ?? s;
      });

      console.log(`[Shot Director] executeLLM imported successfully`);

      // Process scenes in parallel batches
      // Reduce concurrency for long episodes (>15 scenes) to avoid rate limiting
      const CONCURRENCY = mergedScenes.length > 15 ? 3 : 5;

      type ShotResult = {
        sceneNumber: number;
        shotNumber: number;
        shotType: string;
        cameraDirection: string;
        description: string;
        duration: number;
        characters: string[];
        veoPrompt: Record<string, unknown>;
        metadata: {
          location: string;
          timeOfDay: string;
          mood?: string;
          lighting?: string;
        };
        transitionType?: string;
        frameStrategy?: string;
        primarySubject?: { type: string; name: string };
        firstFrameDescription?: string | null;
        lastFrameDescription?: string | null;
        locationArea?: string | null;
        locationEnvironmentDescription?: string | null;
      };

      /** What the prompt says about the scene as a whole (FILM-1901) */
      type SceneResult = {
        sceneNumber: number;
        sceneSummary?: string;
        sceneViralScore?: number;
        sceneHookType?: string | null;
        sceneStandaloneSummary?: string | null;
      };

      const allShots: ShotResult[] = [];
      const sceneResults: SceneResult[] = [];
      let failedScenes = 0;

      for (let i = 0; i < mergedScenes.length; i += CONCURRENCY) {
        const batch = mergedScenes.slice(i, i + CONCURRENCY);
        const batchNum = Math.floor(i / CONCURRENCY) + 1;
        const totalBatches = Math.ceil(mergedScenes.length / CONCURRENCY);

        console.log(
          `[Shot Director] Processing batch ${batchNum}/${totalBatches} ` +
            `(scenes ${batch.map((s) => s.number).join(', ')})`,
        );

        // Use Promise.allSettled for per-scene resilience —
        // one failed scene should NOT kill the entire batch
        const batchSettled = await Promise.allSettled(
          batch.map(
            async (
              scene,
            ): Promise<{ shots: ShotResult[]; scene: SceneResult }> => {
              const isReelCandidate = reelCandidateScenes.includes(
                scene.number,
              );

              console.log(
                `[Shot Director] Generating shots for scene ${scene.number}` +
                  (isReelCandidate ? ' [REEL PRIORITY]' : ''),
              );

              const sceneContent = JSON.stringify({
                number: scene.number,
                heading: scene.heading,
                location: scene.location,
                timeOfDay: scene.timeOfDay,
                description: scene.description,
                action: scene.action,
                dialogue: scene.dialogue,
              });

              const episodeMetadata = JSON.stringify({
                title: episodeTitle,
                genre,
                targetAudience,
                visualStyle,
                tone,
              });

              const reelNote = reelNoteFor(scene.number, reelCandidateScenes);

              const result = await executeLLM<{
                shots: Array<{
                  shotNumber: number;
                  shotType: string;
                  cameraDirection: string;
                  description: string;
                  duration: number;
                  characters: string[];
                  veoPrompt: {
                    shotLine: string;
                    audio: string;
                    style: string;
                    avoid: string;
                    fullPrompt: string;
                  };
                  metadata: {
                    location: string;
                    timeOfDay: string;
                    mood?: string;
                    lighting?: string;
                  };
                  transitionType?: string;
                  frameStrategy?: string;
                  primarySubject?: { type: string; name: string };
                  firstFrameDescription?: string | null;
                  lastFrameDescription?: string | null;
                  locationArea?: string | null;
                  locationEnvironmentDescription?: string | null;
                }>;
                sceneSummary: string;
                sceneViralScore?: number;
                sceneHookType?: string | null;
                sceneStandaloneSummary?: string | null;
              }>({
                templateSlug: 'scene-shot-generation',
                variables: {
                  scene_number: scene.number,
                  total_scenes: scenes.length,
                  scene_content: sceneContent,
                  episode_metadata: episodeMetadata,
                  characters,
                  locations,
                  previous_scene_summary: '',
                  reel_note: reelNote,
                  recurring_element: recurringElements ?? '',
                  shot_duration_min: shotDuration.min,
                  shot_duration_max: shotDuration.max,
                },
                context: {
                  name: 'agent.shotDirector.generateShots',
                  accountId: '',
                },
              });

              // Normalize enum fields: LLM often outputs kebab-case (e.g. "two-shot")
              // but the Zod schema expects snake_case (e.g. "two_shot")
              const normalizedShots = result.data.shots.map((shot) => ({
                ...shot,
                duration: clampShotDuration(shot.duration, shotDuration),
                sceneNumber: scene.number,
                frameStrategy: shot.frameStrategy?.replace(/-/g, '_'),
                transitionType: shot.transitionType?.replace(/-/g, '_'),
              }));

              console.log(
                `[Shot Director] Scene ${scene.number} complete — ${normalizedShots.length} shots generated`,
              );

              return {
                shots: normalizedShots,
                scene: {
                  sceneNumber: scene.number,
                  sceneSummary: result.data.sceneSummary,
                  sceneViralScore: result.data.sceneViralScore,
                  sceneHookType: result.data.sceneHookType,
                  sceneStandaloneSummary: result.data.sceneStandaloneSummary,
                },
              };
            },
          ),
        );

        // Collect successful results, log failures
        for (let j = 0; j < batchSettled.length; j++) {
          const result = batchSettled[j]!;
          const scene = batch[j]!;

          if (result.status === 'fulfilled') {
            allShots.push(...result.value.shots);
            sceneResults.push(result.value.scene);
          } else {
            failedScenes++;
            console.error(
              `[Shot Director] Scene ${scene.number} FAILED (continuing with remaining scenes): ${result.reason?.message ?? result.reason}`,
            );
          }
        }

        console.log(
          `[Shot Director] Batch ${batchNum}/${totalBatches} done. ` +
            `Running total: ${allShots.length} shots` +
            (failedScenes > 0 ? ` (${failedScenes} scenes failed)` : ''),
        );
      }

      // Reassign global sequence numbers
      const shotsWithSequence = allShots.map((shot, idx) => ({
        ...shot,
        shotNumber: idx + 1,
      }));

      console.log(
        `[Shot Director] Complete — ${shotsWithSequence.length} shots across ${scenes.length} scenes`,
      );

      if (shotsWithSequence.length === 0) {
        const errorMsg = `Shot Director generated 0 shots — all ${scenes.length} scenes failed. Check scene-shot-generation prompt and model config.`;
        console.error(`[Shot Director] ${errorMsg}`);
        return toolError(errorMsg);
      }

      return toolSuccess({
        shots: shotsWithSequence,
        sceneResults,
        totalShots: shotsWithSequence.length,
        scenesProcessed: scenes.length,
        reelCandidatesOptimized: reelCandidateScenes.length,
        summary: `Generated ${shotsWithSequence.length} shots across ${scenes.length} scenes. ${reelCandidateScenes.length} scenes had hook-priority treatment.`,
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error(
        `[Shot Director] Fatal error in generateShots: ${message}`,
        error,
      );
      return toolError(`Shot Director failed: ${message}`);
    }
  },

  // OPT-2: Drop the massive shots array from history, keep only counts
  // Full shot data is preserved in the step trace (AgentStep.toolResult)
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      totalShots: d.totalShots,
      scenesProcessed: d.scenesProcessed,
      reelCandidatesOptimized: d.reelCandidatesOptimized,
      summary: d.summary,
    };
  },
});

export const shotDirectorSkill: Skill = {
  name: 'shot-director',
  description:
    'Generates a VEO 3.1 optimized shot list for all screenplay scenes. Prioritizes hook-optimized shot compositions for scenes identified as Reel candidates by the Reel Scout.',
  tools: [generateShotsTool],
  contextPrompt: `You are the Shot Director — a visual production specialist for short-form video content.

You translate screenplay scenes into VEO 3.1 optimized shot lists:
- Each shot has a complete 7-component VEO prompt (subject, action, scene, style, dialogue, sounds, negative)
- For Reel candidate scenes: Shot 1 is always a hook shot (close-up or dramatic reveal)
- Character descriptions must match the VEO context provided EXACTLY — never invent attributes
- Use varied shot types: wide establishing, medium two-shot, close-up reaction, POV`,
  instructions: `1. Call generateShots with all screenplay scenes and the reelCandidateScenes list from Reel Scout
2. Pass the full VEO character context verbatim
3. Report totalShots and scenesProcessed to the Orchestrator
4. The Orchestrator will persist shots to the database`,
};
