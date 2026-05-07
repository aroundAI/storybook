import { describe, expect, it } from 'vitest';

import { shouldBlockContent } from '../documentary/fact-checker-shared';
import type { FactCheckResult } from '../documentary/fact-checker-shared';

function makeResult(overrides: Partial<FactCheckResult> = {}): FactCheckResult {
  return {
    overallVerdict: 'pass',
    accuracyScore: 0.95,
    totalClaimsFound: 5,
    verifiedClaims: 5,
    issues: [],
    missingRequiredClaims: [],
    citationsValid: true,
    summary: 'All checks passed.',
    ...overrides,
  };
}

describe('shouldBlockContent', () => {
  it('should NOT block when all checks pass', () => {
    const result = makeResult();
    expect(shouldBlockContent(result)).toBe(false);
  });

  it('should block when there is a critical issue', () => {
    const result = makeResult({
      overallVerdict: 'fail',
      issues: [
        {
          severity: 'critical',
          claimInContent: 'Water boils at 50°C',
          issueType: 'inaccurate',
          explanation: 'Water boils at 100°C at sea level',
          suggestion: 'Correct the temperature',
        },
      ],
    });
    expect(shouldBlockContent(result)).toBe(true);
  });

  it('should block when there are 3 or more warnings', () => {
    const warning = {
      severity: 'warning' as const,
      claimInContent: 'Unsourced claim',
      issueType: 'unsourced' as const,
      explanation: 'No source provided',
      suggestion: 'Add citation',
    };
    const result = makeResult({
      overallVerdict: 'warnings',
      issues: [warning, warning, warning],
    });
    expect(shouldBlockContent(result)).toBe(true);
  });

  it('should NOT block when there are fewer than 3 warnings', () => {
    const warning = {
      severity: 'warning' as const,
      claimInContent: 'Unsourced claim',
      issueType: 'unsourced' as const,
      explanation: 'No source provided',
      suggestion: 'Add citation',
    };
    const result = makeResult({
      overallVerdict: 'warnings',
      issues: [warning, warning],
    });
    expect(shouldBlockContent(result)).toBe(false);
  });

  it('should block when accuracy score is below 0.8', () => {
    const result = makeResult({
      overallVerdict: 'fail',
      accuracyScore: 0.65,
    });
    expect(shouldBlockContent(result)).toBe(true);
  });

  it('should NOT block when accuracy score is exactly 0.8', () => {
    const result = makeResult({
      accuracyScore: 0.8,
    });
    expect(shouldBlockContent(result)).toBe(false);
  });

  it('should NOT block for minor/info issues only', () => {
    const result = makeResult({
      issues: [
        {
          severity: 'minor',
          claimInContent: 'Citation format off',
          issueType: 'citation_error',
          explanation: 'Missing period',
          suggestion: 'Add trailing period',
        },
        {
          severity: 'info',
          claimInContent: 'Could add more detail',
          issueType: 'unsourced',
          explanation: 'Suggestion only',
          suggestion: 'Consider elaborating',
        },
      ],
    });
    expect(shouldBlockContent(result)).toBe(false);
  });

  it('should prioritize critical check before warning count', () => {
    const result = makeResult({
      overallVerdict: 'fail',
      accuracyScore: 0.9,
      issues: [
        {
          severity: 'critical',
          claimInContent: 'Wrong fact',
          issueType: 'inaccurate',
          explanation: 'Incorrect',
          suggestion: 'Fix it',
        },
      ],
    });
    // Should block even though accuracy is fine and only 1 issue
    expect(shouldBlockContent(result)).toBe(true);
  });
});
