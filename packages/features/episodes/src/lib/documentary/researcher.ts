/**
 * Documentary Researcher
 * Phase 11.3: FILM-1122
 *
 * LLM-powered research phase for documentary content.
 * Identifies claims, matches to verified facts, flags unverified claims.
 */

import { sanitizeForPrompt } from '../sanitize-for-prompt';
import { getProjectContext } from './helpers';

// =============================================================================
// TYPES
// =============================================================================

export interface ResearchClaim {
    claim: string;
    category: string;
    matchedFactId: string | null;
    confidence: 'verified' | 'likely' | 'needs_source';
    priority: 'critical' | 'important' | 'nice_to_have';
    suggestedSearch: string;
}

export interface ResearchResult {
    topicSummary: string;
    claims: ResearchClaim[];
    researchGaps: string[];
    recommendedSources: string[];
    verifiedCount: number;
    needsSourceCount: number;
}

// Row shape returned from the verified_facts table
interface VerifiedFactRow {
    id: string;
    claim: string;
    source_citation: string;
    category: string | null;
}

// LLM response shape
interface ResearchLLMResponse {
    research: {
        topic_summary: string;
        claims: Array<{
            claim: string;
            category: string;
            matched_fact_id: string | null;
            confidence: string;
            priority: string;
            suggested_search: string;
        }>;
        research_gaps: string[];
        recommended_sources: string[];
    };
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Run research phase for a documentary topic.
 *
 * 1. Fetches existing verified facts for the project
 * 2. Passes them + the topic to the researcher-role LLM
 * 3. Validates matched fact IDs against real DB rows
 */
export async function runResearchPhase(
    projectId: string,
    topic: string,
    premise?: string,
    targetClaims?: string[],
): Promise<ResearchResult> {
    const { executeLLM } = await import('@kit/prompt-engine/server');
    const { accountId, userId, supabase } = await getProjectContext(projectId);

    // Fetch verified facts for this project
    // Limit to 1000 as a safeguard. If hit, the LLM may miss valid facts.
    const { data: rawFacts } = await supabase
        .from('verified_facts')
        .select('id, claim, source_citation, category')
        .eq('project_id', projectId)
        .eq('verification_status', 'verified')
        .limit(1000);

    const facts = (rawFacts ?? []) as VerifiedFactRow[];

    if (facts.length === 1000) {
        console.warn(
            `[researcher] Project ${projectId} has ≥1000 verified facts — results may be truncated. Consider pagination.`,
        );
    }

    // Format existing facts for prompt
    const existingFactsText =
        facts.length > 0
            ? facts
                .map(
                    (f) =>
                        `[${f.id}] ${f.claim} (Source: ${f.source_citation})`,
                )
                .join('\n')
            : 'No existing facts in database.';

    // Run researcher LLM
    const result = await executeLLM<ResearchLLMResponse>({
        templateSlug: 'researcher-role',
        variables: {
            topic: sanitizeForPrompt(topic),
            premise: sanitizeForPrompt(premise ?? ''),
            existing_facts: sanitizeForPrompt(existingFactsText),
            target_claims: sanitizeForPrompt(targetClaims?.join('\n') ?? ''),
        },
        context: { name: 'researcher-role', accountId, userId },
        supabaseClient: supabase,
    });

    const research = result.data.research;

    // Validate matched fact IDs actually exist
    const factIdSet = new Set(facts.map((f) => f.id));
    const validatedClaims: ResearchClaim[] = research.claims.map((c) => {
        const isValidMatch =
            c.matched_fact_id !== null && factIdSet.has(c.matched_fact_id);

        // If the LLM hallucinated a matched_fact_id, downgrade 'verified' to
        // 'needs_source' so unverified claims are never trusted as verified.
        const finalConfidence = isValidMatch
            ? 'verified'
            : c.confidence === 'verified'
                ? 'needs_source'
                : c.confidence;

        return {
            claim: c.claim,
            category: c.category,
            matchedFactId: isValidMatch ? c.matched_fact_id : null,
            confidence: finalConfidence as ResearchClaim['confidence'],
            priority: c.priority as 'critical' | 'important' | 'nice_to_have',
            suggestedSearch: c.suggested_search,
        };
    });

    return {
        topicSummary: research.topic_summary,
        claims: validatedClaims,
        researchGaps: research.research_gaps,
        recommendedSources: research.recommended_sources,
        verifiedCount: validatedClaims.filter((c) => c.confidence === 'verified')
            .length,
        needsSourceCount: validatedClaims.filter(
            (c) => c.confidence === 'needs_source',
        ).length,
    };
}

/**
 * Format research results into a string for downstream prompt injection.
 */
export function formatResearchForPrompt(result: ResearchResult): string {
    if (result.claims.length === 0) {
        return 'No research claims identified.';
    }

    const sections: string[] = [
        `## Research Summary\n${sanitizeForPrompt(result.topicSummary)}`,
        `\n## Verified Claims (${result.verifiedCount})`,
    ];

    const verified = result.claims.filter((c) => c.confidence === 'verified');
    if (verified.length > 0) {
        sections.push(
            verified
                .map((c) => `- ✅ ${sanitizeForPrompt(c.claim)} [fact:${c.matchedFactId}]`)
                .join('\n'),
        );
    }

    const needsSource = result.claims.filter(
        (c) => c.confidence === 'needs_source',
    );
    if (needsSource.length > 0) {
        sections.push(`\n## Needs Source (${needsSource.length})`);
        sections.push(
            needsSource
                .map((c) => `- ⚠️ ${sanitizeForPrompt(c.claim)} (search: "${sanitizeForPrompt(c.suggestedSearch)}")`)
                .join('\n'),
        );
    }

    if (result.researchGaps.length > 0) {
        sections.push('\n## Research Gaps');
        sections.push(result.researchGaps.map((g) => `- ${sanitizeForPrompt(g)}`).join('\n'));
    }

    return sections.join('\n');
}
