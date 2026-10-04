import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';

import { factCheckContentAction } from '../src/server/fact-check-actions';

// FILM-1123. The action is what a person reaches runFactCheck through: it
// returns the check and whether the content should be held back, and it
// returns a failed check as a value.

const runFactCheck = vi.fn();

vi.mock('../src/lib/documentary/fact-checker', async () => {
  const shared = await import('../src/lib/documentary/fact-checker-shared');
  return {
    runFactCheck: (...args: unknown[]) => runFactCheck(...args),
    shouldBlockContent: shared.shouldBlockContent,
  };
});

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: 'user-1' }),
  ),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn() }),
}));

const PROJECT = '11111111-1111-4111-8111-111111111111';

const passing = {
  overallVerdict: 'pass',
  accuracyScore: 0.95,
  totalClaimsFound: 2,
  verifiedClaims: 2,
  issues: [],
  missingRequiredClaims: [],
  citationsValid: true,
  summary: 'ok',
};

describe('factCheckContentAction (FILM-1123)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the check and does not block sound content', async () => {
    runFactCheck.mockResolvedValue(passing);

    await expect(
      factCheckContentAction({ projectId: PROJECT, content: 'text' }),
    ).resolves.toEqual({ ok: true, data: { result: passing, blocked: false } });
    expect(runFactCheck).toHaveBeenCalledWith(PROJECT, 'text', undefined);
  });

  it('blocks content with a critical issue', async () => {
    const failing = {
      ...passing,
      overallVerdict: 'fail',
      issues: [
        {
          severity: 'critical',
          claimInContent: 'x',
          issueType: 'inaccurate',
          explanation: 'e',
          suggestion: 's',
        },
      ],
    };
    runFactCheck.mockResolvedValue(failing);

    await expect(
      factCheckContentAction({
        projectId: PROJECT,
        content: 'text',
        requiredClaims: ['c'],
      }),
    ).resolves.toEqual({ ok: true, data: { result: failing, blocked: true } });
    expect(runFactCheck).toHaveBeenCalledWith(PROJECT, 'text', ['c']);
  });

  it('returns a failed check as a value naming what did not happen', async () => {
    runFactCheck.mockRejectedValue(new Error('model timed out'));

    await expect(
      factCheckContentAction({ projectId: PROJECT, content: 'text' }),
    ).resolves.toEqual({
      ok: false,
      error:
        'Could not fact-check the content. Try again; if it keeps failing, reload the page.',
    });
  });

  it('returns a refused run in the gateway’s words (KB-182)', async () => {
    runFactCheck.mockRejectedValue(
      new ActionRefusal('Server generation is off.'),
    );

    await expect(
      factCheckContentAction({ projectId: PROJECT, content: 'text' }),
    ).resolves.toEqual({ ok: false, error: 'Server generation is off.' });
  });
});
