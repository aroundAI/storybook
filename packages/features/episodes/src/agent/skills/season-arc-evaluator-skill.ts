/**
 * Season Arc Evaluator Skill
 *
 * Wraps arc quality evaluation as an agent-callable tool.
 * Evaluates a season's episode outlines for arc progression,
 * conflict diversity, and character arc coherence.
 *
 * Used by the Season Orchestrator as a post-generation quality gate:
 *   1. Season Outliner generates episode outlines
 *   2. Arc Evaluator scores them across 3 dimensions
 *   3. If verdict is 'revise', orchestrator feeds weak episodes back to outliner
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface WeakEpisode {
  episodeNumber: number;
  issue: string;
  suggestion: string;
}

interface ArcEvaluation {
  overallArcScore: number;
  arcProgression: number;
  conflictDiversity: number;
  characterArcCoherence: number;
  weakEpisodes: WeakEpisode[];
  verdict: 'pass' | 'revise';
  summary: string;
}

const evaluateSeasonArcTool = createTool({
  name: 'evaluateSeasonArc',
  description:
    'Evaluates season episode outlines for arc quality across 3 dimensions: arcProgression (do stakes escalate?), conflictDiversity (are conflicts distinct?), characterArcCoherence (do character arcs track?). Returns overallArcScore (0-1), per-dimension scores, weak episodes with fixes, and a pass/revise verdict. Call this after season outline generation to decide whether episodes need revision.',
  parameters: z.object({
    episodes: z
      .string()
      .describe('JSON stringified array of episode outlines to evaluate'),
    genre: z
      .string()
      .describe('Content genre (detective, comedy, drama, etc.)'),
    seasonPremise: z
      .string()
      .describe('The overarching season premise for context'),
  }),

  execute: async ({ episodes, genre, seasonPremise }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<ArcEvaluation>({
        templateSlug: 'quality-evaluation/story-quality',
        variables: {
          content: episodes,
          genre,
          season_premise: seasonPremise,
        },
        context: {
          name: 'agent.seasonArcEvaluator.evaluateSeasonArc',
          accountId: context.accountId,
        },
      });

      if (
        typeof result.data.overallArcScore !== 'number' ||
        isNaN(result.data.overallArcScore)
      ) {
        return toolError(
          `Arc Evaluator returned invalid score (${result.data.overallArcScore}). LLM response may be malformed. Retry.`,
        );
      }

      return toolSuccess({
        overallArcScore: result.data.overallArcScore,
        arcProgression: result.data.arcProgression,
        conflictDiversity: result.data.conflictDiversity,
        characterArcCoherence: result.data.characterArcCoherence,
        weakEpisodes: result.data.weakEpisodes,
        verdict: result.data.verdict,
        summary: result.data.summary,
      });
    } catch (error) {
      return toolError(
        `Season arc evaluation failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep scores + verdict + weak episode count, drop detailed suggestions
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const weakEpisodes = d.weakEpisodes as WeakEpisode[] | undefined;
    return {
      success: true,
      overallArcScore: d.overallArcScore,
      verdict: d.verdict,
      weakEpisodeCount: weakEpisodes?.length ?? 0,
      summary: d.summary,
    };
  },
});

export const seasonArcEvaluatorSkill: Skill = {
  name: 'season-arc-evaluator',
  description:
    'Evaluates season arc quality across 3 dimensions: arc progression, conflict diversity, and character arc coherence. Returns a pass/revise verdict with specific weak episode feedback.',
  tools: [evaluateSeasonArcTool],
  contextPrompt: `You have access to a Season Arc Evaluator that checks episode outlines for:
- Arc Progression (0-1): Do stakes escalate across episodes? Early episodes should establish, middle should complicate, late should resolve.
- Conflict Diversity (0-1): Are episode conflicts distinct? Each episode needs a unique central tension — no repetitive patterns.
- Character Arc Coherence (0-1): Do character arcs track logically? Growth should feel earned and consistent across episodes.

Quality thresholds:
- verdict 'pass': Arc score is acceptable — proceed with these outlines
- verdict 'revise': Weak episodes identified — feed them back to the outliner for targeted revision`,
  instructions: `1. Call evaluateSeasonArc after outline generation with the full episodes JSON
2. If verdict is 'pass', the season outlines are ready
3. If verdict is 'revise', pass weakEpisodes back to the Season Outliner for targeted revision — include each weak episode's issue and suggestion in the revision context
4. Include overallArcScore and verdict in the final answer`,
};
