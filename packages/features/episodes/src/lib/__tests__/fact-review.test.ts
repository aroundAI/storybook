import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FACT_REFUSALS,
  factRefusal,
} from '../../server/fact-review-refusals';

/**
 * KB-18. The rules themselves — who may review, from which state — live in
 * `public.set_fact_verification` and are tested with real roles in
 * `apps/web/supabase/tests/database/verified-facts-review.test.sql`. A mocked
 * client cannot reject SQL; these check only what the TypeScript owns: that
 * the actions go through the function and never a bare UPDATE, and that each
 * refusal the database raises comes back as a sentence, not a throw.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (
    fn: (data: Record<string, unknown>, user: unknown) => Promise<unknown>,
  ) => {
    return (data: Record<string, unknown>) => fn(data, { id: 'user-1' });
  },
}));

interface Result {
  data: unknown;
  error: { code?: string; details?: string | null; message: string } | null;
}

const client = vi.hoisted(() => {
  const chain = {
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  };

  return {
    rpc: vi.fn(),
    from: vi.fn(() => chain),
    chain,
  };
});

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => client,
}));

const { verifyFactAction, disputeFactAction, deleteFactAction } =
  await import('../../server/fact-actions');

const FACT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const base = { factId: FACT, projectId: PROJECT, basePath: '/facts' };

function rpcResult(result: Result) {
  client.rpc.mockResolvedValueOnce(result);
}

describe('factRefusal', () => {
  it.each([
    ['42501', 'verify', FACT_REFUSALS.reviewForbidden],
    ['42501', 'dispute', FACT_REFUSALS.reviewForbidden],
    ['42501', 'delete', FACT_REFUSALS.deleteForbidden],
    ['P0002', 'verify', FACT_REFUSALS.notFound],
    ['P0002', 'delete', FACT_REFUSALS.notFound],
    ['22023', 'dispute', FACT_REFUSALS.reasonRequired],
  ] as const)('%s on %s reads as written', (code, action, sentence) => {
    expect(factRefusal({ code }, action)).toBe(sentence);
  });

  it('names the status a fact was already reviewed to', () => {
    expect(factRefusal({ code: '55000', details: 'disputed' }, 'verify')).toBe(
      'This fact is already disputed. Reload the page to see its current state.',
    );
  });

  it('is not a refusal for anything it does not know', () => {
    expect(factRefusal({ code: 'XX000' }, 'verify')).toBeNull();
    expect(factRefusal({ code: '55000', details: 'weird' }, 'verify')).toBeNull();
    expect(factRefusal({ code: '22023' }, 'verify')).toBeNull();
    expect(factRefusal({}, 'verify')).toBeNull();
  });
});

describe('verifyFactAction / disputeFactAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies through set_fact_verification, never a bare UPDATE', async () => {
    rpcResult({ data: 'verified', error: null });

    const result = await verifyFactAction({
      ...base,
      verificationNotes: 'Checked',
    });

    expect(result).toEqual({ ok: true, data: { status: 'verified' } });
    expect(client.rpc).toHaveBeenCalledWith('set_fact_verification', {
      target_fact_id: FACT,
      outcome: 'verified',
      notes: 'Checked',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('disputes with the reason', async () => {
    rpcResult({ data: 'disputed', error: null });

    const result = await disputeFactAction({
      ...base,
      disputeReason: 'Wrong year',
    });

    expect(result).toEqual({ ok: true, data: { status: 'disputed' } });
    expect(client.rpc).toHaveBeenCalledWith('set_fact_verification', {
      target_fact_id: FACT,
      outcome: 'disputed',
      notes: 'Wrong year',
    });
  });

  it('returns a refusal as a value', async () => {
    rpcResult({
      data: null,
      error: { code: '42501', message: 'Only the project…' },
    });

    await expect(verifyFactAction(base)).resolves.toEqual({
      ok: false,
      error: FACT_REFUSALS.reviewForbidden,
    });
  });

  it('returns a stale review as a value naming the current status', async () => {
    rpcResult({
      data: null,
      error: { code: '55000', details: 'verified', message: 'Fact is already verified' },
    });

    await expect(
      disputeFactAction({ ...base, disputeReason: 'late' }),
    ).resolves.toEqual({
      ok: false,
      error: FACT_REFUSALS.alreadyReviewed('verified'),
    });
  });

  it('keeps an unexpected failure thrown, for monitoring', async () => {
    rpcResult({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    });

    await expect(verifyFactAction(base)).rejects.toThrow(
      'Failed to verify fact: connection failure',
    );
  });
});

describe('deleteFactAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.chain.delete.mockReturnValue(client.chain);
    client.chain.eq.mockReturnValue(client.chain);
  });

  it('refuses someone who is not the project owner or an admin, without deleting', async () => {
    rpcResult({ data: false, error: null });

    await expect(deleteFactAction(base)).resolves.toEqual({
      ok: false,
      error: FACT_REFUSALS.deleteForbidden,
    });
    expect(client.rpc).toHaveBeenCalledWith('can_edit_project', {
      target_project_id: PROJECT,
    });
    expect(client.chain.delete).not.toHaveBeenCalled();
  });

  it('says so when nothing was deleted, instead of reporting success', async () => {
    rpcResult({ data: true, error: null });
    client.chain.select.mockResolvedValueOnce({ data: [], error: null });

    await expect(deleteFactAction(base)).resolves.toEqual({
      ok: false,
      error: FACT_REFUSALS.notFound,
    });
  });

  it('deletes the fact', async () => {
    rpcResult({ data: true, error: null });
    client.chain.select.mockResolvedValueOnce({
      data: [{ id: FACT }],
      error: null,
    });

    await expect(deleteFactAction(base)).resolves.toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(client.chain.select).toHaveBeenCalledWith('id');
  });
});
