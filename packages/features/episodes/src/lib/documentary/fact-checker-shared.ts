/**
 * Documentary Fact-Checker — Client-Safe Shared Types & Pure Functions
 * Phase 11.3: FILM-1123
 *
 * Contains types and pure functions that can be used in both
 * client and server components. Server-only code (LLM calls,
 * Supabase queries) lives in fact-checker.ts.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface FactCheckIssue {
  severity: 'critical' | 'warning' | 'minor' | 'info';
  claimInContent: string;
  issueType:
    | 'inaccurate'
    | 'unsourced'
    | 'misrepresented'
    | 'citation_error'
    | 'missing_claim';
  explanation: string;
  verifiedFact?: string;
  suggestion: string;
}

export interface FactCheckResult {
  overallVerdict: 'pass' | 'fail' | 'warnings';
  accuracyScore: number;
  totalClaimsFound: number;
  verifiedClaims: number;
  issues: FactCheckIssue[];
  missingRequiredClaims: string[];
  citationsValid: boolean;
  summary: string;
}

// =============================================================================
// PURE FUNCTIONS
// =============================================================================

/**
 * Determine whether content should be blocked based on fact-check results.
 *
 * Blocks when:
 * - Any critical issues exist
 * - 3 or more warning-level issues
 * - Accuracy score below 0.8
 */
export function shouldBlockContent(result: FactCheckResult): boolean {
  const WARNING_THRESHOLD = 3;
  const MINIMUM_ACCURACY_SCORE = 0.8;

  // Block on any critical issues
  if (result.issues.some((i) => i.severity === 'critical')) {
    return true;
  }

  // Block if too many warnings
  const warningCount = result.issues.filter(
    (i) => i.severity === 'warning',
  ).length;
  if (warningCount >= WARNING_THRESHOLD) {
    return true;
  }

  // Block if accuracy too low
  if (result.accuracyScore < MINIMUM_ACCURACY_SCORE) {
    return true;
  }

  return false;
}
