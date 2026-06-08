/**
 * Shot Quality Evaluator Skill
 *
 * Wraps the shot-quality prompt as an agent-callable tool.
 * Evaluates a generated VEO 3.1 shot list for prompt compliance,
 * visual consistency, shot diversity, and production suitability.
 *
 * Used by the Shot Orchestrator as a post-generation quality gate:
 *   1. Shot Director generates shots
 *   2. Shot Quality Evaluator scores them
 *   3. If score < 0.7, orchestrator can request targeted fixes
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface ShotIssue {
  shotNumber: number;
  issue: string;
  fix: string;
}

interface ShotQualityResult {
  overallScore: number;
  dimensions: {
    veoCompliance: number;
    characterConsistency: number;
    shotDiversity: number;
    visualContinuity: number;
    audioSpecificity: number;
    negativePromptCompleteness: number;
    subjectRichness: number;
  };
  totalShots: number;
  compliantShots: number;
  critique: string;
  strengths: string[];
  weaknesses: string[];
  shotIssues: ShotIssue[];
  revisionPriority: string;
}

const evaluateShotQualityTool = createTool({
  name: 'evaluateShotQuality',
  description:
    'Evaluates a VEO 3.1 shot list for quality across 7 dimensions: veoCompliance, characterConsistency, shotDiversity, visualContinuity, audioSpecificity, negativePromptCompleteness, subjectRichness. Returns overall score (0-1), per-dimension scores, and specific shot issues with fixes. Score >= 0.8 means production-ready. 0.6-0.79 means some shots need revision. Below 0.6 means systematic rework needed.',
  parameters: z.object({
    episodeTitle: z.string().describe('Episode title for context'),
    genre: z.string().describe('Content genre'),
    totalScenes: z.number().describe('Total number of scenes'),
    shotsJson: z
      .union([z.string(), z.array(z.any())])
      .transform((val) => (typeof val === 'string' ? val : JSON.stringify(val)))
      .describe(
        'The shot list to evaluate — JSON stringified array of shots with VEO 3.1 components. Can be a JSON string or array.',
      ),
    contextHint: z
      .string()
      .optional()
      .describe(
        'Optional context: character names, specific concerns, or areas to focus evaluation on',
      ),
  }),
  execute: async ({
    episodeTitle,
    genre,
    totalScenes,
    shotsJson,
    contextHint,
  }) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const contextLine = contextHint
        ? `Episode: "${episodeTitle}" | Genre: ${genre} | Scenes: ${totalScenes}\n${contextHint}`
        : `Episode: "${episodeTitle}" | Genre: ${genre} | Scenes: ${totalScenes}`;

      const result = await executeLLM<ShotQualityResult>({
        templateSlug: 'quality-evaluation/shot-quality',
        variables: {
          shots_content: shotsJson,
          context_hint: contextLine,
        },
        context: {
          name: 'agent.shotQuality.evaluateShotQuality',
          accountId: '',
        },
      });

      const evaluation = result.data;

      if (
        typeof evaluation.overallScore !== 'number' ||
        isNaN(evaluation.overallScore)
      ) {
        return toolError(
          `Shot Quality returned invalid score (${evaluation.overallScore}). LLM response may be malformed. Retry.`,
        );
      }

      const decision =
        evaluation.overallScore >= 0.8
          ? 'pass'
          : evaluation.overallScore >= 0.6
            ? 'revise'
            : 'rework';

      return toolSuccess({
        overallScore: evaluation.overallScore,
        decision,
        dimensions: evaluation.dimensions,
        totalShots: evaluation.totalShots,
        compliantShots: evaluation.compliantShots,
        critique: evaluation.critique,
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses,
        shotIssues: evaluation.shotIssues,
        revisionPriority: evaluation.revisionPriority,
      });
    } catch (error) {
      return toolError(
        `Shot quality evaluation failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep score + decision + issue count, drop per-shot details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const issues = d.shotIssues as ShotIssue[] | undefined;
    return {
      success: true,
      overallScore: d.overallScore,
      decision: d.decision,
      dimensions: d.dimensions,
      totalShots: d.totalShots,
      compliantShots: d.compliantShots,
      issueCount: issues?.length ?? 0,
      revisionPriority: d.revisionPriority,
    };
  },
});

export const shotQualitySkill: Skill = {
  name: 'shot-quality',
  description:
    'Evaluates a VEO 3.1 shot list for production quality across 7 dimensions. Returns a pass/revise/rework decision, per-dimension scores, and specific per-shot issues with suggested fixes.',
  tools: [evaluateShotQualityTool],
  contextPrompt: `You have access to a Shot Quality Evaluator that checks VEO 3.1 shot lists for:
- VEO compliance (all 7 components present per shot)
- Character consistency (physical descriptions match across shots)
- Shot diversity (varied shot types, angles, movements)
- Visual continuity (lighting, environment consistency within scenes)
- Audio specificity (distinct, specific sound design per shot)
- Negative prompt completeness (subtitle/watermark exclusions)
- Subject richness (15+ character attributes)

Quality thresholds:
- >= 0.8: Production-ready — proceed to video generation
- 0.6-0.79: Some shots need targeted revision
- < 0.6: Systematic issues — requires rework

When revising, focus on the revisionPriority and shotIssues with specific fixes.`,
  instructions: `1. After generateShots completes, call evaluateShotQuality with the shot list JSON
2. If decision is 'pass' (>= 0.8), proceed — shots are production-ready
3. If decision is 'revise' (0.6-0.79), note the shotIssues for the handler to address
4. If decision is 'rework' (< 0.6), report the systematic issues to the Orchestrator
5. Include the overallScore and decision in the final answer`,
};
