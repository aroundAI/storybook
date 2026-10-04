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
import { sanitizeForPrompt } from '../sanitize-for-prompt';
import type { FactCheckIssue, FactCheckResult } from './fact-checker-shared';
import { getProjectContext } from './helpers';
import type { VerifiedFactRow } from './types';

// Re-export types and pure functions from client-safe shared module
export {
  shouldBlockContent,
  type FactCheckIssue,
  type FactCheckResult,
} from './fact-checker-shared';

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

// Valid values for runtime validation
const VALID_VERDICTS = new Set(['pass', 'fail', 'warnings']);
const VALID_SEVERITIES = new Set(['critical', 'warning', 'minor', 'info']);
const VALID_ISSUE_TYPES = new Set([
  'inaccurate',
  'unsourced',
  'misrepresented',
  'citation_error',
  'missing_claim',
]);

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
  const { executeLLM, openRun } = await import('@kit/ai-gateway');
  const { refuseRunError } = await import('@kit/ai-gateway/refuse-run-error');
  const { accountId, userId, supabase } = await getProjectContext(projectId);

  // Fetch all verified facts for this project
  // Limit to 1000 as a safeguard. If hit, the LLM may miss citation errors.
  const { data: rawFacts, error: factsError } = await supabase
    .from('verified_facts')
    .select('id, claim, source_citation, category')
    .eq('project_id', projectId)
    .eq('verification_status', 'verified')
    .limit(1000);

  if (factsError) {
    console.warn(
      `[fact-checker] verified_facts query failed for project ${projectId}:`,
      factsError.message,
    );
  }

  const facts = (rawFacts ?? []) as VerifiedFactRow[];

  if (facts.length === 1000) {
    console.warn(
      `[fact-checker] Project ${projectId} has ≥1000 verified facts — results may be truncated. Consider pagination.`,
    );
  }

  // Return a descriptive result instead of throwing when no facts exist,
  // so automated pipelines don't crash unexpectedly.
  if (facts.length === 0) {
    return {
      overallVerdict: 'fail',
      accuracyScore: 0,
      totalClaimsFound: 0,
      verifiedClaims: 0,
      issues: [
        {
          severity: 'critical',
          claimInContent: '',
          issueType: 'unsourced',
          explanation:
            'No verified facts found. Add facts before fact-checking.',
          suggestion:
            'Add verified facts to the project before running the fact-checker.',
        },
      ],
      missingRequiredClaims: requiredClaims ?? [],
      citationsValid: false,
      summary: 'No verified facts in project — cannot fact-check content.',
    };
  }

  // Format facts for prompt
  const verifiedFactsText = facts
    .map(
      (f) =>
        `FACT [${f.id}]: ${f.claim}\n  Source: ${f.source_citation}\n  Category: ${f.category ?? 'uncategorized'}`,
    )
    .join('\n\n');

  // The model is reached through a run (FILM-1902): a server-only
  // fact_check run on the project, opened as the caller, in the team's mode
  const run = await openRun(
    'fact_check',
    {
      type: 'project',
      id: projectId,
      accountId,
      projectId,
      // No StageDefinition serves fact_check: the input is the call's target
      input: { kind: 'stage', target: { projectId } },
    },
    { kind: 'web', name: 'documentary.factCheck' },
    { client: supabase, accountId, userId, runMode: () => 'server' },
  ).catch(refuseRunError);

  let result: Awaited<ReturnType<typeof executeLLM<FactCheckLLMResponse>>>;

  try {
    result = await executeLLM<FactCheckLLMResponse>({
      run,
      templateSlug: 'documentary/fact-checker-role',
      variables: {
        content: sanitizeForPrompt(content),
        verified_facts: sanitizeForPrompt(verifiedFactsText),
        required_claims: sanitizeForPrompt(requiredClaims?.join('\n') ?? ''),
      },
      context: { name: 'fact-checker-role', accountId, userId },
    });
    await run.complete();
  } catch (error) {
    await run.fail(error).catch(() => undefined);
    // A refusal the user can act on (the daily cap) reaches the action's
    // withRefusals as words; anything else is rethrown as it was (KB-182)
    return refuseRunError(error);
  }

  const check = result.data.fact_check;

  // Runtime-validate LLM output to catch unexpected values
  const verdict = VALID_VERDICTS.has(check.overall_verdict)
    ? (check.overall_verdict as FactCheckResult['overallVerdict'])
    : 'fail';

  return {
    overallVerdict: verdict,
    accuracyScore: check.accuracy_score,
    totalClaimsFound: check.total_claims_found,
    verifiedClaims: check.verified_claims,
    issues: check.issues.map((i) => ({
      severity: (VALID_SEVERITIES.has(i.severity)
        ? i.severity
        : 'warning') as FactCheckIssue['severity'],
      claimInContent: i.claim_in_content,
      issueType: (VALID_ISSUE_TYPES.has(i.issue_type)
        ? i.issue_type
        : 'unsourced') as FactCheckIssue['issueType'],
      explanation: i.explanation,
      verifiedFact: i.verified_fact,
      suggestion: i.suggestion,
    })),
    missingRequiredClaims: check.missing_required_claims,
    citationsValid: check.citations_valid,
    summary: check.summary,
  };
}
