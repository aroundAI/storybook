/**
 * Translation Verifier Skill
 *
 * Wraps translation quality verification as an agent-callable tool.
 * Uses the `quality-evaluation/story-quality` prompt template to assess
 * translated dialogue against the original for semantic fidelity,
 * cultural appropriateness, emotional tone preservation, and
 * lip-sync timing compliance.
 *
 * Used by the Translation Orchestrator as a post-translation quality gate:
 *   1. Translation Skill translates dialogue
 *   2. Translation Verifier scores the output
 *   3. If verdict is 'revise', orchestrator re-translates problematic lines
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface DivergentLine {
  lineIndex: number;
  original: string;
  translated: string;
  issue: string;
  severity: 'critical' | 'warning' | 'minor';
}

interface TranslationVerification {
  overallScore: number;
  divergentLines: DivergentLine[];
  culturalIssues: string[];
  timingViolations: number[];
  verdict: 'pass' | 'revise';
}

const verifyTranslationTool = createTool({
  name: 'verifyTranslation',
  description:
    'Verifies translation quality by comparing original English dialogue against translated lines. Evaluates semantic fidelity, cultural appropriateness, emotional tone preservation, and lip-sync timing compliance. Returns a pass/revise verdict with specific divergent lines and issues.',
  parameters: z.object({
    originalLines: z
      .string()
      .describe('Original English dialogue lines (numbered)'),
    translatedLines: z
      .string()
      .describe('Translated dialogue lines (numbered)'),
    targetLanguage: z
      .string()
      .describe('Language of the translations (e.g. "Hindi", "Spanish")'),
    preserveTiming: z
      .boolean()
      .describe('Whether timing constraints apply for lip-sync'),
  }),

  execute: async (
    { originalLines, translatedLines, targetLanguage, preserveTiming },
    context,
  ) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const verificationContent = [
        `## Original Lines (English)`,
        originalLines,
        ``,
        `## Translated Lines (${targetLanguage})`,
        translatedLines,
        ``,
        `## Evaluation Criteria`,
        `- Semantic fidelity: does each translated line convey the same meaning?`,
        `- Emotional tone: is the character's emotion preserved?`,
        `- Cultural appropriateness: are idioms and references culturally adapted?`,
        preserveTiming
          ? `- Timing compliance: are translations within ±20% of original syllable/word count?`
          : `- Timing: not constrained`,
        ``,
        `Return verdict "pass" if overallScore >= 0.8, otherwise "revise".`,
      ].join('\n');

      const result = await executeLLM<TranslationVerification>({
        templateSlug: 'quality-evaluation/story-quality',
        variables: {
          story_content: verificationContent,
          context_hint: `Translation verification: ${targetLanguage} | Timing: ${preserveTiming ? 'constrained' : 'unconstrained'}`,
        },
        context: {
          name: 'agent.translation.verifyTranslation',
          accountId: context.accountId,
        },
      });

      const verification = result.data;

      if (
        typeof verification.overallScore !== 'number' ||
        isNaN(verification.overallScore)
      ) {
        return toolError(
          `Translation verification returned invalid score (${verification.overallScore}). Retry.`,
        );
      }

      return toolSuccess({
        verdict: verification.verdict,
        overallScore: verification.overallScore,
        divergentCount: verification.divergentLines.length,
        criticalIssues: verification.divergentLines.filter(
          (d) => d.severity === 'critical',
        ),
        culturalIssues: verification.culturalIssues,
        timingViolationCount: verification.timingViolations.length,
      });
    } catch (error) {
      return toolError(
        `Translation verification failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep verdict + score + counts, drop per-line details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const criticalIssues = d.criticalIssues as DivergentLine[] | undefined;
    return {
      success: true,
      verdict: d.verdict,
      overallScore: d.overallScore,
      divergentCount: d.divergentCount,
      criticalIssueCount: criticalIssues?.length ?? 0,
      timingViolationCount: d.timingViolationCount,
    };
  },
});

export const translationVerifierSkill: Skill = {
  name: 'translation-verifier',
  description:
    'Verifies translation quality by comparing original and translated dialogue. Evaluates semantic fidelity, cultural appropriateness, emotional tone preservation, and lip-sync timing compliance. Returns a pass/revise verdict with specific issues.',
  tools: [verifyTranslationTool],
  contextPrompt: `You have access to a Translation Verifier that quality-checks translated dialogue against the original English.

The verifier evaluates:
- Semantic fidelity: does the translation preserve the original meaning?
- Emotional tone: is the character's emotion and subtext intact?
- Cultural appropriateness: are idioms and cultural references properly adapted?
- Lip-sync timing: do translations fit within timing constraints (when enabled)?

Quality thresholds:
- >= 0.8: Pass — translations are production-ready
- < 0.8: Revise — critical issues must be fixed before use

When verdict is 'revise', the criticalIssues array contains specific lines that need re-translation.`,
  instructions: `1. Call verifyTranslation AFTER translateDialogue completes
2. Pass the original English lines, translated lines, target language, and timing flag
3. If verdict is 'pass' (>= 0.8), translations are ready for production
4. If verdict is 'revise', pass the criticalIssues back to translateDialogue for targeted re-translation of only the problematic lines
5. Include overallScore and verdict in the final answer`,
};
