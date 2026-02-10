/**
 * Documentary Fact-Checker
 * Phase 11.3: FILM-1123
 *
 * LLM-powered fact-checking for documentary content.
 * Validates claims against verified facts, checks citations,
 * and determines whether content should be blocked.
 *
 * NOTE: This file imports server-only deps (Supabase, prompt-engine).
 * Client-safe types and pure functions are in fact-checker-shared.ts.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { sanitizeForPrompt } from '../sanitize-for-prompt';

// Re-export types and pure functions from client-safe shared module
export type { FactCheckIssue, FactCheckResult } from './fact-checker-shared';
export { shouldBlockContent } from './fact-checker-shared';

// Import types locally for use in this file
import type { FactCheckResult } from './fact-checker-shared';
import type { FactCheckIssue } from './fact-checker-shared';

// Row shape returned from the verified_facts table
interface VerifiedFactRow {
    id: string;
    claim: string;
    source_citation: string;
    category: string | null;
}

// LLM response shape
interface FactCheckLLMResponse {
    fact_check: {
        overall_verdict: string;
        accuracy_score: number;
        total_claims_found: number;
        verified_claims: number;
        issues: Array<{
            severity: string;
            claim_in_content: string;
            issue_type: string;
            explanation: string;
            verified_fact?: string;
            suggestion: string;
        }>;
        missing_required_claims: string[];
        citations_valid: boolean;
        summary: string;
    };
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Run fact-check on documentary content.
 *
 * 1. Fetches all verified facts for the project
 * 2. Passes content + facts to the fact-checker-role LLM
 * 3. Parses and returns structured results
 */
export async function runFactCheck(
    projectId: string,
    content: string,
    requiredClaims?: string[],
): Promise<FactCheckResult> {
    const { executeLLM } = await import('@kit/prompt-engine/server');
    const supabase = getSupabaseServerClient();

    // Fetch project to get account_id for LLM context logging
    const { data: project } = await supabase
        .from('projects')
        .select('account_id')
        .eq('id', projectId)
        .single();

    if (!project) {
        throw new Error(`Project not found: ${projectId}`);
    }

    // Get authenticated user for audit logging
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? '';

    // Fetch all verified facts for this project
    // verified_facts table added by migration 20260211100000 — not in generated types yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawFacts } = await (supabase as any)
        .from('verified_facts')
        .select('id, claim, source_citation, category')
        .eq('project_id', projectId)
        .eq('verification_status', 'verified')
        .limit(1000);

    const facts = (rawFacts ?? []) as VerifiedFactRow[];

    if (facts.length === 0) {
        throw new Error(
            'No verified facts found. Add facts before fact-checking.',
        );
    }

    // Format facts for prompt
    const verifiedFactsText = facts
        .map(
            (f) =>
                `FACT [${f.id}]: ${f.claim}\n  Source: ${f.source_citation}\n  Category: ${f.category ?? 'uncategorized'}`,
        )
        .join('\n\n');

    // Run fact-checker LLM
    const result = await executeLLM<FactCheckLLMResponse>({
        templateSlug: 'fact-checker-role',
        variables: {
            content: sanitizeForPrompt(content),
            verified_facts: sanitizeForPrompt(verifiedFactsText),
            required_claims: sanitizeForPrompt(requiredClaims?.join('\n') ?? ''),
        },
        context: { name: 'fact-checker-role', accountId: project.account_id, userId },
        supabaseClient: supabase,
    });

    const check = result.data.fact_check;

    return {
        overallVerdict: check.overall_verdict as FactCheckResult['overallVerdict'],
        accuracyScore: check.accuracy_score,
        totalClaimsFound: check.total_claims_found,
        verifiedClaims: check.verified_claims,
        issues: check.issues.map((i) => ({
            severity: i.severity as FactCheckIssue['severity'],
            claimInContent: i.claim_in_content,
            issueType: i.issue_type as FactCheckIssue['issueType'],
            explanation: i.explanation,
            verifiedFact: i.verified_fact,
            suggestion: i.suggestion,
        })),
        missingRequiredClaims: check.missing_required_claims,
        citationsValid: check.citations_valid,
        summary: check.summary,
    };
}
