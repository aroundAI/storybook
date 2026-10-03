/**
 * Fact Checker Skill
 *
 * Wraps the documentary/fact-checker-role prompt as an agent-callable tool.
 * Validates generated documentary/educational content against a verified facts
 * database, checking for inaccuracies, unsupported claims, and missing
 * required citations.
 *
 * Used AFTER story generation to ensure factual accuracy. If the verdict
 * is 'fail', the story MUST be revised before proceeding.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface FactCheckIssue {
  severity: 'critical' | 'warning' | 'minor' | 'info';
  claim_in_content: string;
  issue_type: string;
  explanation: string;
  verified_fact: string;
  suggestion: string;
}

interface FactCheckResult {
  fact_check: {
    overall_verdict: 'pass' | 'fail' | 'warnings';
    accuracy_score: number;
    total_claims_found: number;
    verified_claims: number;
    issues: FactCheckIssue[];
    missing_required_claims: string[];
    citations_valid: boolean;
    summary: string;
  };
}

const factCheckContentTool = createTool({
  name: 'factCheckContent',
  description:
    'Validates generated documentary/educational content against a verified facts database. Returns overall verdict (pass/fail/warnings), accuracy score, per-issue breakdown with severity levels (critical/warning/minor/info), and missing required claims. Critical issues MUST be fixed. Call AFTER story generation.',
  parameters: z.object({
    content: z.string().describe('The generated content to fact-check'),
    verifiedFacts: z
      .string()
      .describe('Pre-formatted verified facts database to check against'),
    requiredClaims: z
      .string()
      .optional()
      .describe('Claims that must be present in the content'),
  }),
  execute: async ({ content, verifiedFacts, requiredClaims }, context) => {
    try {
      const { executeLLM } = await import('@kit/ai-gateway');

      const result = await executeLLM<FactCheckResult>({
        templateSlug: 'documentary/fact-checker-role',
        variables: {
          content,
          verified_facts: verifiedFacts,
          required_claims: requiredClaims ?? '',
        },
        context: {
          name: 'agent.factChecker.factCheckContent',
          accountId: context.accountId,
        },
      });

      const fc = result.data.fact_check;

      return toolSuccess({
        verdict: fc.overall_verdict,
        accuracyScore: fc.accuracy_score,
        totalClaimsFound: fc.total_claims_found,
        verifiedClaims: fc.verified_claims,
        criticalIssues: fc.issues.filter((i) => i.severity === 'critical'),
        warningIssues: fc.issues.filter((i) => i.severity === 'warning'),
        missingClaims: fc.missing_required_claims,
        summary: fc.summary,
      });
    } catch (error) {
      return toolError(`Fact-check failed: ${(error as Error).message}`);
    }
  },

  // OPT-2: Keep verdict + scores + issue counts, drop per-issue details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const critical = d.criticalIssues as FactCheckIssue[] | undefined;
    const warnings = d.warningIssues as FactCheckIssue[] | undefined;
    return {
      success: true,
      verdict: d.verdict,
      accuracyScore: d.accuracyScore,
      totalClaimsFound: d.totalClaimsFound,
      verifiedClaims: d.verifiedClaims,
      criticalIssueCount: critical?.length ?? 0,
      warningIssueCount: warnings?.length ?? 0,
      summary: d.summary,
    };
  },
});

export const factCheckerSkill: Skill = {
  name: 'fact-checker',
  description:
    'Validates documentary/educational content against a verified facts database. Returns accuracy scores, per-issue breakdowns, and a pass/fail/warnings verdict that gates content progression.',
  tools: [factCheckContentTool],
  contextPrompt: `You have access to a strict Fact Checker for documentary/educational content.

Verdict meanings:
- 'pass': All claims verified, content is factually sound — proceed
- 'warnings': Minor inaccuracies or missing context — should be addressed but not blocking
- 'fail': Critical factual errors found — story MUST be revised before proceeding

Issue severities:
- critical: Factually incorrect statement that could mislead viewers — MUST be fixed
- warning: Imprecise or oversimplified claim — SHOULD be addressed
- minor: Stylistic concern or minor imprecision — fix if convenient
- info: Observation or suggestion — no action required

The accuracy_score (0-1) reflects overall factual reliability of the content.`,
  instructions: `1. Call factCheckContent AFTER story generation to validate factual accuracy
2. If verdict is 'fail', the story MUST be revised — pass criticalIssues to the Story Director
3. If verdict is 'warnings', review warningIssues and address where possible
4. If verdict is 'pass', proceed to the next pipeline stage
5. Check missingClaims — required facts that were omitted must be incorporated
6. Re-run factCheckContent after revisions to confirm the fix`,
};
