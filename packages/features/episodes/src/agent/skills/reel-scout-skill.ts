/**
 * Reel Scout Skill
 *
 * Wraps the reel-scout prompt as agent-callable tools.
 * The Reel Scout evaluates each screenplay scene as a standalone Reel/Shorts
 * candidate, producing rich textual reasoning per scene that:
 * 1. Informs the Orchestrator which scenes to target for reel optimization
 * 2. Feeds shot-level requirements into the Shot Composer
 * 3. Populates shots.shorts_metadata with whyThisWorksAsReel + keyMoment
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface ReelSceneAnalysis {
  sceneNumber: number;
  isReelCandidate: boolean;
  viralScore: number;
  hookType?:
    | 'question'
    | 'reveal'
    | 'conflict'
    | 'visual'
    | 'humor'
    | 'cliffhanger'
    | 'character'
    | 'action'
    | 'reaction'
    | 'punchline'
    | null;
  estimatedDurationSeconds: number;
  keyMoment?: string | null;
  sceneEmotionalArc: string;
  whyThisWorksAsReel?: string | null;
  whyItDoesntWork?: string | null;
  improvementSuggestion?: string | null;
}

const analyzeScenesTool = createTool({
  name: 'analyzeScenes',
  description:
    'Evaluates all screenplay scenes as standalone Reel candidates. For each scene produces: isReelCandidate, viralScore (1-10), hookType, keyMoment, sceneEmotionalArc, whyThisWorksAsReel, whyItDoesntWork, improvementSuggestion. Also returns topReelCandidates (scene numbers) and orchestratorNote.',
  parameters: z.object({
    episodeTitle: z.string().describe('Episode title'),
    genre: z.string().describe('Content genre'),
    scenes: z
      .array(
        z.object({
          number: z.number(),
          heading: z.string().optional(),
          description: z.string().optional(),
          dialogue: z
            .array(
              z.object({
                character: z.string(),
                text: z.string(),
              }),
            )
            .optional(),
          estimatedDuration: z.number().optional(),
        }),
      )
      .describe('Array of screenplay scenes to evaluate'),
  }),
  execute: async ({ episodeTitle, genre, scenes }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      // Merge LLM-provided sparse scenes with full context data
      const fullScenes = context?._scenesContext ?? scenes;
      const mergedScenes = scenes.map((s) => {
        const full = (fullScenes as typeof scenes).find(
          (f) => f.number === s.number,
        );
        return full ?? s;
      });

      const result = await executeLLM<{
        sceneAnalyses: ReelSceneAnalysis[];
        topReelCandidates: number[];
        orchestratorNote: string;
      }>({
        templateSlug: 'quality-evaluation/reel-scout',
        variables: {
          episode_title: episodeTitle,
          genre,
          total_scene_count: mergedScenes.length,
          scenes_json: JSON.stringify(mergedScenes),
        },
        context: { name: 'agent.reelScout.analyzeScenes', accountId: '' },
      });

      const { sceneAnalyses, topReelCandidates, orchestratorNote } =
        result.data;

      const candidates = sceneAnalyses.filter((s) => s.isReelCandidate);
      const nonCandidates = sceneAnalyses.filter((s) => !s.isReelCandidate);

      return toolSuccess({
        sceneAnalyses,
        topReelCandidates,
        orchestratorNote,
        summary: `${candidates.length}/${scenes.length} scenes qualify as Reel candidates. Top: Scenes ${topReelCandidates.join(', ')}.`,
        candidateCount: candidates.length,
        nonCandidateCount: nonCandidates.length,
      });
    } catch (error) {
      return toolError(
        `Reel Scout analysis failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Drop per-scene analyses from history, keep only candidate list + counts
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      topReelCandidates: d.topReelCandidates,
      candidateCount: d.candidateCount,
      nonCandidateCount: d.nonCandidateCount,
      summary: d.summary,
      orchestratorNote: d.orchestratorNote,
    };
  },
});

export const reelScoutSkill: Skill = {
  name: 'reel-scout',
  description:
    'Evaluates screenplay scenes as standalone Reel/Shorts candidates. Produces rich textual reasoning per scene (whyThisWorksAsReel, keyMoment, sceneEmotionalArc) and instructs the Shot Composer on hook optimization priorities.',
  tools: [analyzeScenesTool],
  contextPrompt: `You are the Reel Scout — a short-form content strategist specializing in Instagram Reels and TikTok.
    
A valid Reel candidate must be:
1. SELF-CONTAINED: Emotionally complete without episode context
2. HOOKED IN 3s: Conflict/anomaly/question in the very first moment
3. SHAREABLE: Has one moment viewers would describe to others

Ideal Reel duration: 30–90 seconds (4–11 shots at 8s each).
Scoring: 9-10 = drop-in ready, 7-8 = minor adjustments, 5-6 = possible with editing, 1-4 = not a candidate.`,
  instructions: `1. Call analyzeScenes with all screenplay scenes
2. Report topReelCandidates to the Orchestrator
3. For each candidate scene, share the whyThisWorksAsReel and keyMoment
4. For non-candidates, share whyItDoesntWork and improvementSuggestion
5. Share orchestratorNote so the Shot Composer can prioritize visual hooks per candidate scene`,
};
