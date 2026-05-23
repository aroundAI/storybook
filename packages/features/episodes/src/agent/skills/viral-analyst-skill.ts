/**
 * Viral Analyst Skill
 *
 * Wraps the story-quality prompt as an agent-callable tool.
 * The Viral Analyst evaluates story/screenplay content across 7 viral dimensions
 * and returns textual reasoning (whyThisWorks, whatToImprove) that the
 * Orchestrator uses to decide whether to revise or proceed.
 */
import { z } from 'zod';

import { createTool, toolError, toolSuccess } from '@kit/agent';
import type { Skill } from '@kit/agent';

const evaluateContentTool = createTool({
  name: 'evaluateContent',
  description:
    'Evaluates a story or screenplay for viral potential across 7 dimensions (hook strength, curiosity gap, emotional arc, setup-payoff, dialogue subtext, loopability, memorable moment). Returns overall score, dimension breakdown, whyThisWorks text, whatToImprove text, and top priorities. Call this after story generation to decide whether to revise.',
  parameters: z.object({
    title: z.string().describe('The episode or story title'),
    genre: z
      .string()
      .describe('Content genre (detective, romance, thriller, etc.)'),
    targetAudience: z.string().describe('Target audience description'),
    targetDuration: z.number().describe('Target duration in seconds'),
    storyText: z.string().describe('The full story text to evaluate'),
  }),
  execute: async ({
    title,
    genre,
    targetAudience,
    targetDuration,
    storyText,
  }) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<{
        evaluation: {
          overallScore: number;
          decision: string;
          dimensions: Record<
            string,
            { score: number; feedback: string; evidence?: string }
          >;
          topPriorities: string[];
          strengths: string[];
        };
      }>({
        templateSlug: 'quality-evaluation/story-quality',
        variables: {
          title,
          genre,
          target_audience: targetAudience,
          target_duration: targetDuration,
          story_text: storyText,
        },
        context: { name: 'agent.viralAnalyst.evaluateContent', accountId: '' },
      });

      const { overallScore, decision, dimensions, topPriorities, strengths } =
        result.data.evaluation;

      // Validate the score is a real number — prevent silent undefined propagation
      if (typeof overallScore !== 'number' || isNaN(overallScore)) {
        return toolError(
          `Viral Analyst returned an invalid score (${overallScore}). LLM response may be malformed. Retry.`,
        );
      }

      // Synthesize textual whyThisWorks from strong dimensions
      const strongDimensions = Object.entries(dimensions)
        .filter(([, v]) => v.score >= 0.7)
        .map(([k, v]) => `${k}: ${v.feedback}`)
        .join(' ');

      const weakDimensions = Object.entries(dimensions)
        .filter(([, v]) => v.score < 0.6)
        .map(([k, v]) => `${k}: ${v.feedback}`)
        .join(' ');

      return toolSuccess({
        overallScore,
        decision,
        whyThisWorks: strongDimensions || 'No dimensions scored above 0.7.',
        whatToImprove: weakDimensions || 'No significant weaknesses detected.',
        topPriorities,
        strengths,
        dimensionScores: Object.fromEntries(
          Object.entries(dimensions).map(([k, v]) => [k, v.score]),
        ),
      });
    } catch (error) {
      return toolError(`Viral analysis failed: ${(error as Error).message}`);
    }
  },

  // OPT-2: Keep score + decision + priorities, drop verbose feedback text
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      overallScore: d.overallScore,
      decision: d.decision,
      topPriorities: d.topPriorities,
      dimensionScores: d.dimensionScores,
    };
  },
});

export const viralAnalystSkill: Skill = {
  name: 'viral-analyst',
  description:
    'Evaluates content for viral potential across 7 proven dimensions. Provides scores, textual reasoning, and prioritized revision suggestions.',
  tools: [evaluateContentTool],
  contextPrompt: `You are the Viral Analyst. Your role is to objectively evaluate content quality using the 7-dimension viral framework:
- hookStrength: Does it open with immediate conflict/anomaly/action?
- curiosityGap: Is there a specific withheld fact that drives viewers to the end?
- emotionalArc: Does it move through 3 distinct emotional phases?
- setupPayoff: Is there a planted detail in Act 1 that pays off in Act 3?
- dialogueSubtext: Do characters show emotion through behavior, not literal statements?
- loopability: Does the ending echo the opening for rewatch potential?
- memorableMoment: Is there one scene so striking viewers would describe it to someone?

Pass threshold: 0.65 overall. Revise zone: 0.50–0.64. Major rewrite: < 0.50.`,
  instructions: `1. Call evaluateContent with the full story text
2. Return the result to the Orchestrator — include overallScore, decision, whyThisWorks, whatToImprove
3. If decision is 'revise', highlight the top 2 priorities the Story Director should fix
4. If decision is 'major-rewrite', note which dimensions scored below 0.5`,
};
