/**
 * Researcher Skill
 *
 * Wraps the documentary/researcher-role prompt as an agent-callable tool.
 * Identifies factual claims in documentary/educational content that need
 * verification, categorizes them by priority, and suggests research sources.
 *
 * Used BEFORE story generation for documentary/educational content types
 * to build a verified facts foundation.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface ResearchClaim {
  claim: string;
  category: string;
  matched_fact_id: string | null;
  confidence: 'verified' | 'needs_source';
  priority: 'critical' | 'important' | 'nice_to_have';
  suggested_search: string;
}

interface ResearchResult {
  research: {
    topic_summary: string;
    claims: ResearchClaim[];
    research_gaps: string[];
    recommended_sources: string[];
  };
}

const identifyResearchNeedsTool = createTool({
  name: 'identifyResearchNeeds',
  description:
    'Analyzes a documentary/educational topic to identify factual claims that need verification. Returns categorized claims with confidence levels (verified/needs_source), priority (critical/important/nice_to_have), research gaps, and recommended sources. Call BEFORE story generation for documentary/educational content types.',
  parameters: z.object({
    topic: z.string().describe('The documentary/educational topic'),
    premise: z
      .string()
      .optional()
      .describe('The angle or approach for the content'),
    existingFacts: z
      .string()
      .optional()
      .describe('Pre-formatted verified facts to check against'),
    targetClaims: z
      .string()
      .optional()
      .describe('Specific claims the content wants to make'),
  }),
  execute: async ({ topic, premise, existingFacts, targetClaims }, context) => {
    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<ResearchResult>({
        templateSlug: 'documentary/researcher-role',
        variables: {
          topic,
          premise: premise ?? '',
          existing_facts: existingFacts ?? '',
          target_claims: targetClaims ?? '',
        },
        context: {
          name: 'agent.researcher.identifyResearchNeeds',
          accountId: context.accountId,
        },
      });

      const { claims, topic_summary, research_gaps, recommended_sources } =
        result.data.research;

      return toolSuccess({
        topicSummary: topic_summary,
        totalClaims: claims.length,
        verifiedClaims: claims.filter((c) => c.confidence === 'verified')
          .length,
        needsSourceClaims: claims.filter((c) => c.confidence === 'needs_source')
          .length,
        criticalClaims: claims.filter((c) => c.priority === 'critical'),
        researchGaps: research_gaps,
        recommendedSources: recommended_sources,
      });
    } catch (error) {
      return toolError(
        `Research needs identification failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep summary + counts, drop per-claim details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const gaps = d.researchGaps as string[] | undefined;
    return {
      success: true,
      topicSummary: d.topicSummary,
      totalClaims: d.totalClaims,
      verifiedClaims: d.verifiedClaims,
      needsSourceClaims: d.needsSourceClaims,
      researchGapsCount: gaps?.length ?? 0,
    };
  },
});

export const researcherSkill: Skill = {
  name: 'researcher',
  description:
    'Identifies factual claims that need verification in documentary/educational content. Categorizes claims by priority and confidence, highlights research gaps, and recommends authoritative sources.',
  tools: [identifyResearchNeedsTool],
  contextPrompt: `You have access to a Research Analyst that identifies factual claims requiring verification in documentary/educational content.

For each claim discovered, it provides:
- confidence: 'verified' (matched against existing facts) or 'needs_source' (requires external verification)
- priority: 'critical' (content integrity depends on it), 'important' (strengthens credibility), 'nice_to_have' (adds depth)
- suggested_search: a query string to find authoritative sources

Critical claims MUST be verified before the content proceeds to story generation.
Research gaps indicate areas where the topic lacks sufficient factual coverage.`,
  instructions: `1. Call identifyResearchNeeds BEFORE story generation for documentary/educational content types
2. Review criticalClaims — all must have verified sources before proceeding
3. Use researchGaps to identify areas needing additional fact-gathering
4. Pass verified facts forward to the Story Director as context
5. If needsSourceClaims is high relative to totalClaims, gather more facts before generating content`,
};
