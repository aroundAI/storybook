import { describe, expect, it, vi } from 'vitest';

import type { McpTokenVerification, McpTokenVerifier } from '../src';
import { type McpAuthDeps, withMcpAuth } from '../src/server/with-mcp-auth';

/**
 * FILM-1904: a request without a usable credential is refused with the code
 * a client can act on, before any tool runs. Each refusal the verifier can
 * return maps to UNAUTHORIZED (401); a token whose user left the team maps
 * to FORBIDDEN (403).
 */

const CONNECTION = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  accountId: '33333333-3333-4333-8333-333333333333',
  kind: 'pat' as const,
  clientName: 'laptop',
  scopes: ['studio:read' as const],
};

function verifierReturning(result: McpTokenVerification): McpTokenVerifier {
  return { kind: 'own', verify: vi.fn().mockResolvedValue(result) };
}

function deps(
  verification: McpTokenVerification,
  member = true,
): McpAuthDeps & { signer: { sign: ReturnType<typeof vi.fn> } } {
  const sign = vi.fn().mockResolvedValue('minted.jwt');

  return {
    verifier: verifierReturning(verification),
    signer: { kind: 'hs256-secret', sign },
    createUserClient: vi.fn().mockReturnValue({ tag: 'user-client' }),
    checkMembership: vi.fn().mockResolvedValue(member),
    touchConnection: vi.fn().mockResolvedValue(undefined),
  };
}

function request(authorization?: string) {
  return new Request('https://app.test/api/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

const refusal = (reason: 'malformed' | 'unknown' | 'expired' | 'revoked') =>
  ({ ok: false, reason }) as const;

describe('withMcpAuth', () => {
  it('refuses a request with no Authorization header: UNAUTHORIZED, 401', async () => {
    const d = deps({ ok: true, connection: CONNECTION });
    const result = await withMcpAuth(request(), d);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(result.error.code).toBe('UNAUTHORIZED');
    expect(d.verifier.verify).not.toHaveBeenCalled();
    expect(d.signer.sign).not.toHaveBeenCalled();
  });

  it('refuses a non-bearer scheme without consulting the verifier', async () => {
    const d = deps({ ok: true, connection: CONNECTION });
    const result = await withMcpAuth(request('Basic abc'), d);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHORIZED');
    expect(d.verifier.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'not a StoryBook token'],
    ['unknown', 'not recognised'],
    ['expired', 'expired'],
    ['revoked', 'revoked'],
  ] as const)(
    'maps a %s token to UNAUTHORIZED with the reason in details',
    async (reason, wording) => {
      const d = deps(refusal(reason));
      const result = await withMcpAuth(request('Bearer sbk_pat_x'), d);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(401);
      expect(result.error.code).toBe('UNAUTHORIZED');
      expect(result.error.message).toContain(wording);
      expect(result.error.details).toEqual({ reason });
      expect(d.signer.sign).not.toHaveBeenCalled();
    },
  );

  it('refuses a valid token whose user is no longer in the team: FORBIDDEN, 403', async () => {
    const d = deps({ ok: true, connection: CONNECTION }, false);
    const result = await withMcpAuth(request('Bearer sbk_pat_x'), d);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error.code).toBe('FORBIDDEN');
    // The membership question was asked as the user, through the minted client
    expect(d.checkMembership).toHaveBeenCalledWith(
      { tag: 'user-client' },
      CONNECTION.accountId,
    );
    expect(d.touchConnection).not.toHaveBeenCalled();
  });

  it('yields a principal carrying the minted client, and records the use', async () => {
    const d = deps({ ok: true, connection: CONNECTION });
    const result = await withMcpAuth(request('Bearer sbk_pat_x'), d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal).toEqual({
      userId: CONNECTION.userId,
      accountId: CONNECTION.accountId,
      connectionId: CONNECTION.id,
      scopes: ['studio:read'],
      clientName: 'laptop',
      supabase: { tag: 'user-client' },
    });
    expect(d.signer.sign).toHaveBeenCalledWith({
      userId: CONNECTION.userId,
      connectionId: CONNECTION.id,
    });
    expect(d.createUserClient).toHaveBeenCalledWith('minted.jwt');
    expect(d.touchConnection).toHaveBeenCalledWith(CONNECTION.id);
  });

  it('a failure to record last use does not fail the call', async () => {
    const d = deps({ ok: true, connection: CONNECTION });
    d.touchConnection = vi.fn().mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await withMcpAuth(request('Bearer sbk_pat_x'), d);

    expect(result.ok).toBe(true);
    spy.mockRestore();
  });

  it('the token never reaches the principal or the error', async () => {
    const d = deps(refusal('unknown'));
    const result = await withMcpAuth(request('Bearer sbk_pat_SECRETVALUE'), d);

    expect(JSON.stringify(result)).not.toContain('SECRETVALUE');
  });
});
