/**
 * Ideation Evaluator Skill
 *
 * Wraps story idea quality evaluation as an agent-callable tool.
 * Scores each idea on hook strength, originality, conflict clarity,
 * and visual potential, then classifies them as strong/average/weak.
 *
 * Used by the Ideation Orchestrator as a post-generation quality gate:
 *   1. Ideation Director generates ideas
 *   2. Ideation Evaluator scores them
 *   3. If weak ideas exist, orchestrator requests targeted regeneration
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface IdeaEvaluation {
  evaluations: Array<{
    ideaIndex: number;
    hookStrength: number;
    originalityScore: number;
    conflictClarity: number;
    visualPotential: number;
    overallScore: number;
    verdict: 'strong' | 'average' | 'weak';
    feedback: string;
  }>;
  weakIndices: number[];
}

/**
 * Tool: Evaluate Ideas
 *
 * Evaluates a set of story ideas for quality across 4 dimensions.
 * Returns per-idea scores, verdicts, and a list of weak indices for regeneration.
 */
const evaluateIdeasTool = createTool({
  name: 'evaluateIdeas',
  description:
    'Evaluates story ideas for quality across 4 dimensions: hookStrength, originalityScore, conflictClarity, visualPotential. Each idea gets an overallScore (0-1) and a verdict (strong/average/weak). Returns weakIndices — the indices of ideas that should be regenerated. Strong >= 0.7, Average 0.5-0.69, Weak < 0.5.',
  parameters: z.object({
    ideas: z
      .string()
      .describe(
        'JSON stringified array of ideas to evaluate. Each idea should have title, logline, hook, conflict, themes, and visualPotential.',
      ),
    genre: z
      .string()
      .describe('Content genre for context-appropriate evaluation'),
    targetAudience: z
      .string()
      .describe('Target audience for relevance scoring'),
  }),

  execute: async ({ ideas, genre, targetAudience }) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<IdeaEvaluation>({
        templateSlug: 'quality-evaluation/story-quality',
        variables: {
          content: ideas,
          genre,
          target_audience: targetAudience,
        },
        context: {
          name: 'agent.ideationEvaluator.evaluateIdeas',
          accountId: '',
        },
      });

      const { evaluations, weakIndices } = result.data;

      const strongCount = evaluations.filter(
        (e) => e.verdict === 'strong',
      ).length;
      const averageCount = evaluations.filter(
        (e) => e.verdict === 'average',
      ).length;
      const weakCount = evaluations.filter((e) => e.verdict === 'weak').length;

      return toolSuccess({
        evaluations,
        weakIndices,
        strongCount,
        averageCount,
        weakCount,
        summary: `Evaluated ${evaluations.length} ideas: ${strongCount} strong, ${averageCount} average, ${weakCount} weak`,
      });
    } catch (error) {
      return toolError(
        `Ideation evaluation failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep counts + weak indices, drop per-idea feedback text
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      strongCount: d.strongCount,
      averageCount: d.averageCount,
      weakCount: d.weakCount,
      weakIndices: d.weakIndices,
      summary: d.summary,
    };
  },
});

export const ideationEvaluatorSkill: Skill = {
  name: 'ideation-evaluator',
  description:
    'Evaluates story ideas for quality across hook strength, originality, conflict clarity, and visual potential. Returns per-idea scores, verdicts (strong/average/weak), and weak indices for targeted regeneration.',
  tools: [evaluateIdeasTool],
  contextPrompt: `You are the Ideation Evaluator. Your role is to objectively assess story idea quality using 4 dimensions:
- hookStrength: Does the idea immediately grab attention with conflict, mystery, or emotion?
- originalityScore: Is this a fresh take, or a well-trodden trope without a twist?
- conflictClarity: Is the central conflict specific, layered, and compelling?
- visualPotential: Will this idea produce visually striking, cinematic content?

Quality thresholds:
- >= 0.7: Strong — idea is compelling and ready for development
- 0.5-0.69: Average — has potential but needs refinement
- < 0.5: Weak — should be regenerated with a different approach`,
  instructions: `1. Call evaluateIdeas with the JSON-stringified ideas array, genre, and target audience
2. Return evaluations, weakIndices, and counts of strong/average/weak ideas
3. If weakIndices is non-empty, report which ideas need regeneration
4. The Orchestrator will use weakIndices to request targeted regeneration from the Ideation Director`,
};
