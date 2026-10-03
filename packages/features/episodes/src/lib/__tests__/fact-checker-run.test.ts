import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runFactCheck } from '../documentary/fact-checker';

// FILM-1123. runFactCheck reads the project's verified facts, hands them and
// the content to the fact-checker role and returns a validated result. The
// LLM and the database are fakes; what is checked is what the function does
// with them.
//
// FILM-1902: the gateway's executeLLM refuses without a run (LLM_NO_RUN),
// so the fake keeps that rule, and the action opens a `fact_check` run on
// the project, writes through it and closes it.

const executeLLM = vi.fn();
const runs = vi.hoisted(
  () =>
    [] as Array<{
      stage: string;
      target: Record<string, unknown>;
      ctx: Record<string, unknown>;
      run: import('@kit/generation').RunHandle;
    }>,
);

vi.mock('@kit/ai-gateway', async (importOriginal) => {
  const gateway = await importOriginal<typeof import('@kit/ai-gateway')>();
  const { fakeRunHandle } = await import('@kit/generation/testing');

  return {
    executeLLM: (config: { templateSlug: string; run?: never }) => {
      gateway.requireRun(`executeLLM(${config.templateSlug})`, config.run);
      return executeLLM(config);
    },
    openRun: async (
      stage: string,
      target: Record<string, unknown>,
      _origin: unknown,
      ctx: Record<string, unknown>,
    ) => {
      // The fake store's ids are its own UUIDs; `target` is what was asked
      const { run } = fakeRunHandle({
        stage: stage as never,
        targetType: 'project',
      });
      runs.push({ stage, target, ctx, run });
      return run;
    },
  };
});

const factsQuery = vi.fn();

vi.mock('../documentary/helpers', () => ({
  getProjectContext: vi.fn(async () => ({
    accountId: 'account-1',
    userId: 'user-1',
    supabase: {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'limit']) {
          chain[method] = vi.fn(() => chain);
        }
        chain.then = (resolve: (value: unknown) => unknown) =>
          resolve(factsQuery());
        return chain;
      },
    },
  })),
}));

const FACT = {
  id: 'fact-1',
  claim: 'The dam opened in 1936.',
  source_citation: 'Bureau of Reclamation, 1936',
  category: 'history',
};

function llmReturns(factCheck: Record<string, unknown>) {
  executeLLM.mockResolvedValue({
    data: {
      fact_check: {
        overall_verdict: 'pass',
        accuracy_score: 0.95,
        total_claims_found: 2,
        verified_claims: 2,
        issues: [],
        missing_required_claims: [],
        citations_valid: true,
        summary: 'ok',
        ...factCheck,
      },
    },
  });
}

describe('runFactCheck (FILM-1123)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runs.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    factsQuery.mockReturnValue({ data: [FACT], error: null });
  });

  it('sends the content and the verified facts to the fact-checker role', async () => {
    llmReturns({});

    await runFactCheck('project-1', 'The dam opened in 1936.', [
      'The dam opened in 1936.',
    ]);

    const call = executeLLM.mock.calls[0]![0];
    expect(call.templateSlug).toBe('documentary/fact-checker-role');
    expect(call.variables.content).toBe('The dam opened in 1936.');
    expect(call.variables.verified_facts).toContain('FACT [fact-1]');
    expect(call.variables.verified_facts).toContain('Bureau of Reclamation');
    expect(call.variables.required_claims).toBe('The dam opened in 1936.');
    expect(call.context).toEqual({
      name: 'fact-checker-role',
      accountId: 'account-1',
      userId: 'user-1',
    });
  });

  it('writes through a fact_check run on the project, and closes it (FILM-1902)', async () => {
    llmReturns({});

    await runFactCheck('project-1', 'The dam opened in 1936.');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      stage: 'fact_check',
      target: { type: 'project', id: 'project-1', accountId: 'account-1' },
      ctx: { accountId: 'account-1', userId: 'user-1' },
    });
    expect(executeLLM.mock.calls[0]![0].run).toBe(runs[0]!.run);
    expect(runs[0]!.run.status).toBe('committed');
  });

  it('marks the run failed when the model call fails', async () => {
    executeLLM.mockRejectedValue(new Error('model down'));

    await expect(runFactCheck('project-1', 'text')).rejects.toThrow(
      'model down',
    );

    expect(runs[0]!.run.status).toBe('failed');
  });

  it('maps a passing check', async () => {
    llmReturns({});

    await expect(runFactCheck('project-1', 'text')).resolves.toEqual({
      overallVerdict: 'pass',
      accuracyScore: 0.95,
      totalClaimsFound: 2,
      verifiedClaims: 2,
      issues: [],
      missingRequiredClaims: [],
      citationsValid: true,
      summary: 'ok',
    });
  });

  it('surfaces the issues it flagged, with their severity and fix', async () => {
    llmReturns({
      overall_verdict: 'fail',
      accuracy_score: 0.5,
      issues: [
        {
          severity: 'critical',
          claim_in_content: 'The dam opened in 1946.',
          issue_type: 'inaccurate',
          explanation: 'The verified fact says 1936.',
          verified_fact: 'fact-1',
          suggestion: 'Say 1936.',
        },
      ],
      missing_required_claims: ['Height of the dam'],
      citations_valid: false,
    });

    const result = await runFactCheck('project-1', 'text', [
      'Height of the dam',
    ]);

    expect(result.overallVerdict).toBe('fail');
    expect(result.issues).toEqual([
      {
        severity: 'critical',
        claimInContent: 'The dam opened in 1946.',
        issueType: 'inaccurate',
        explanation: 'The verified fact says 1936.',
        verifiedFact: 'fact-1',
        suggestion: 'Say 1936.',
      },
    ]);
    expect(result.missingRequiredClaims).toEqual(['Height of the dam']);
    expect(result.citationsValid).toBe(false);
  });

  it('does not trust a verdict, severity or issue type outside the known values', async () => {
    llmReturns({
      overall_verdict: 'looks great',
      issues: [
        {
          severity: 'catastrophic',
          claim_in_content: 'x',
          issue_type: 'vibes',
          explanation: 'e',
          suggestion: 's',
        },
      ],
    });

    const result = await runFactCheck('project-1', 'text');

    expect(result.overallVerdict).toBe('fail');
    expect(result.issues[0]).toMatchObject({
      severity: 'warning',
      issueType: 'unsourced',
    });
  });

  it('fails without calling the model when the project has no verified facts', async () => {
    factsQuery.mockReturnValue({ data: [], error: null });

    const result = await runFactCheck('project-1', 'text', ['A claim']);

    expect(executeLLM).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
    expect(result).toMatchObject({
      overallVerdict: 'fail',
      citationsValid: false,
      missingRequiredClaims: ['A claim'],
    });
    expect(result.issues[0]).toMatchObject({ severity: 'critical' });
  });

  it('checks only facts a person verified', async () => {
    llmReturns({});
    const seen: Array<[string, unknown]> = [];
    const { getProjectContext } = await import('../documentary/helpers');
    vi.mocked(getProjectContext).mockResolvedValueOnce({
      accountId: 'a',
      userId: 'u',
      supabase: {
        from: () => {
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn(() => chain);
          chain.eq = vi.fn((column: string, value: unknown) => {
            seen.push([column, value]);
            return chain;
          });
          chain.limit = vi.fn(() => chain);
          chain.then = (resolve: (value: unknown) => unknown) =>
            resolve({ data: [FACT], error: null });
          return chain;
        },
      },
    } as never);

    await runFactCheck('project-1', 'text');

    expect(seen).toContainEqual(['project_id', 'project-1']);
    expect(seen).toContainEqual(['verification_status', 'verified']);
  });
});
