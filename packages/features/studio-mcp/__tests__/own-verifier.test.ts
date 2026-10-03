import { describe, expect, it, vi } from 'vitest';

import { createOwnTokenVerifier } from '../src/server/own-verifier';
import {
  generatePersonalAccessToken,
  hashToken,
  isOwnTokenShape,
} from '../src/server/token';

/**
 * The `own` verifier: a token is looked up by its SHA-256 hash and refused
 * for shape, absence, revocation (of the token or its connection) and
 * expiry, each with its own reason.
 */

function adminReturning(
  row: unknown,
  error: { message: string } | null = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, eq };
}

const connection = {
  id: 'c1',
  user_id: 'u1',
  account_id: 'a1',
  kind: 'pat',
  name: 'laptop',
  scopes: ['studio:read', 'studio:write'],
  revoked_at: null,
};

describe('personal access tokens', () => {
  it('generate a sbk_pat_ token of the documented shape, hashed with SHA-256', () => {
    const token = generatePersonalAccessToken();

    expect(token).toMatch(/^sbk_pat_[A-Za-z0-9_-]{43}$/);
    expect(isOwnTokenShape(token)).toBe(true);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toBe(hashToken(generatePersonalAccessToken()));
  });

  it.each([
    '',
    'sbk_pat_',
    'sbk_pat_short',
    'ghp_' + 'a'.repeat(43),
    'eyJhbGciOi.eyJzdWIi.sig',
  ])('rejects the shape of %j without a lookup', async (token) => {
    const { client, eq } = adminReturning(null);
    const result = await createOwnTokenVerifier(client).verify(token);

    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(eq).not.toHaveBeenCalled();
  });
});

describe('createOwnTokenVerifier', () => {
  const token = generatePersonalAccessToken();

  it('looks the token up by hash, never by value', async () => {
    const { client, eq } = adminReturning({
      token_hash: hashToken(token),
      expires_at: null,
      revoked_at: null,
      connection,
    });

    const result = await createOwnTokenVerifier(client).verify(token);

    expect(eq).toHaveBeenCalledWith('token_hash', hashToken(token));
    expect(result).toEqual({
      ok: true,
      connection: {
        id: 'c1',
        userId: 'u1',
        accountId: 'a1',
        kind: 'pat',
        clientName: 'laptop',
        scopes: ['studio:read', 'studio:write'],
      },
    });
  });

  it('an unknown hash is "unknown"', async () => {
    const { client } = adminReturning(null);

    expect(await createOwnTokenVerifier(client).verify(token)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('a revoked token is "revoked"', async () => {
    const { client } = adminReturning({
      token_hash: 'h',
      expires_at: null,
      revoked_at: '2026-10-01T00:00:00Z',
      connection,
    });

    expect(await createOwnTokenVerifier(client).verify(token)).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('a token of a revoked connection is "revoked" too', async () => {
    const { client } = adminReturning({
      token_hash: 'h',
      expires_at: null,
      revoked_at: null,
      connection: { ...connection, revoked_at: '2026-10-01T00:00:00Z' },
    });

    expect(await createOwnTokenVerifier(client).verify(token)).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('a token past expires_at is "expired"; one before it is accepted', async () => {
    const row = {
      token_hash: 'h',
      expires_at: '2026-10-02T12:00:00Z',
      revoked_at: null,
      connection,
    };

    const late = createOwnTokenVerifier(
      adminReturning(row).client,
      () => new Date('2026-10-02T12:00:01Z'),
    );
    const early = createOwnTokenVerifier(
      adminReturning(row).client,
      () => new Date('2026-10-02T11:59:59Z'),
    );

    expect(await late.verify(token)).toEqual({ ok: false, reason: 'expired' });
    expect((await early.verify(token)).ok).toBe(true);
  });

  it('a database error is thrown, not read as a refusal', async () => {
    const { client } = adminReturning(null, { message: 'connection refused' });

    await expect(createOwnTokenVerifier(client).verify(token)).rejects.toThrow(
      /connection refused/,
    );
  });
});
