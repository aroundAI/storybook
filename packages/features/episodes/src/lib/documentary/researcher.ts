/**
 * Documentary Researcher
 * Phase 11.3: FILM-1122
 *
 * LLM-powered research phase for documentary content.
 * Identifies claims, matches to verified facts, flags unverified claims.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';

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
    const supabase = getSupabaseServerClient();

    // Fetch verified facts for this project
    // verified_facts table added by migration 20260211100000 — not in generated types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawFacts } = await (supabase as any)
        .from('verified_facts')
        .select('id, claim, source_citation, category')
        .eq('project_id', projectId)
        .eq('verification_status', 'verified')
        .limit(50);

    const facts = (rawFacts ?? []) as VerifiedFactRow[];

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
            topic,
            premise: premise ?? '',
            existing_facts: existingFactsText,
            target_claims: targetClaims?.join('\n') ?? '',
        },
        context: { name: 'researcher-role', accountId: '', userId: '' },
        supabaseClient: supabase,
    });

    const research = result.data.research;

    // Validate matched fact IDs actually exist
    const factIdSet = new Set(facts.map((f) => f.id));
    const validatedClaims: ResearchClaim[] = research.claims.map((c) => {
        const isValidMatch =
            c.matched_fact_id !== null && factIdSet.has(c.matched_fact_id);

        return {
            claim: c.claim,
            category: c.category,
            matchedFactId: isValidMatch ? c.matched_fact_id : null,
            confidence: (isValidMatch ? 'verified' : c.confidence) as
                | 'verified'
                | 'likely'
                | 'needs_source',
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
        `## Research Summary\n${result.topicSummary}`,
        `\n## Verified Claims (${result.verifiedCount})`,
    ];

    const verified = result.claims.filter((c) => c.confidence === 'verified');
    if (verified.length > 0) {
        sections.push(
            verified
                .map((c) => `- ✅ ${c.claim} [fact:${c.matchedFactId}]`)
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
                .map((c) => `- ⚠️ ${c.claim} (search: "${c.suggestedSearch}")`)
                .join('\n'),
        );
    }

    if (result.researchGaps.length > 0) {
        sections.push('\n## Research Gaps');
        sections.push(result.researchGaps.map((g) => `- ${g}`).join('\n'));
    }

    return sections.join('\n');
}
