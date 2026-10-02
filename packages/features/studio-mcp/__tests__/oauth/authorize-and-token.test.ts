import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  denialLocation,
  issueAuthorizationCode,
  parseAuthorizeRequest,
} from '../../src/server/oauth/authorize';
import { OAuthError } from '../../src/server/oauth/errors';
import { codeChallengeFor, verifyPkce } from '../../src/server/oauth/pkce';
import { handleRevokeRequest } from '../../src/server/oauth/revoke';
import {
  type OAuthStore,
  createMemoryOAuthStore,
} from '../../src/server/oauth/store';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  handleTokenRequest,
} from '../../src/server/oauth/token';
import { hashToken } from '../../src/server/token';

const RESOURCE = 'http://localhost:3000/api/mcp';
const USER = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function storeWithClient() {
  const store = createMemoryOAuthStore();

  store.clients.set('claude', {
    clientId: 'claude',
    clientName: 'Claude',
    redirectUris: [CALLBACK, 'http://localhost:9999/cb'],
    metadataUrl: null,
    createdAt: new Date().toISOString(),
  });

  return store;
}

function verifier() {
  return randomBytes(32).toString('base64url');
}

function authorizeParams(
  overrides: Record<string, string | null> = {},
  codeVerifier = verifier(),
) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'claude',
    redirect_uri: CALLBACK,
    code_challenge: codeChallengeFor(codeVerifier),
    code_challenge_method: 'S256',
    scope: 'studio:read studio:write',
    state: 'xyz',
    resource: RESOURCE,
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  return { params, codeVerifier };
}

async function approve(
  store: OAuthStore,
  params: URLSearchParams,
  now = new Date(),
) {
  const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

  if (!parsed.ok) throw new Error(`unexpected refusal: ${JSON.stringify(parsed)}`);

  return issueAuthorizationCode(store, {
    request: parsed.request,
    userId: USER,
    accountId: TEAM,
    scopes: parsed.request.scopes,
    now,
  });
}

async function exchange(
  store: OAuthStore,
  code: string,
  codeVerifier: string,
  overrides: Record<string, string | null> = {},
  now = new Date(),
) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: 'claude',
    redirect_uri: CALLBACK,
    code_verifier: codeVerifier,
    resource: RESOURCE,
  });

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }

  return handleTokenRequest(params, { store, resource: RESOURCE, now: () => now });
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error;
    throw error;
  }

  throw new Error('expected an OAuthError');
}

describe('PKCE', () => {
  it('accepts the S256 challenge of the verifier and nothing else', () => {
    const v = verifier();

    expect(verifyPkce(v, codeChallengeFor(v))).toBe(true);
    expect(verifyPkce(verifier(), codeChallengeFor(v))).toBe(false);
    expect(verifyPkce('short', codeChallengeFor('short'))).toBe(false);
  });
});

describe('/oauth/authorize request parsing', () => {
  it('accepts a complete PKCE request and reads its scopes, state and resource', async () => {
    const store = storeWithClient();
    const { params } = authorizeParams();

    const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.client.clientName).toBe('Claude');
    expect(parsed.request.scopes).toEqual(['studio:read', 'studio:write']);
    expect(parsed.request.state).toBe('xyz');
    expect(parsed.request.redirectUri).toBe(CALLBACK);
  });

  it('renders, never redirects, when the client is unknown', async () => {
    const store = storeWithClient();
    const { params } = authorizeParams({ client_id: 'nobody' });

    const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

    expect(parsed).toMatchObject({ ok: false, kind: 'render' });
    if (parsed.ok || parsed.kind !== 'render') return;
    expect(parsed.error.code).toBe('invalid_client');
  });

  it('renders, never redirects, when the redirect URI is not registered exactly', async () => {
    const store = storeWithClient();

    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'https://CLAUDE.ai/api/mcp/auth_callback',
    ]) {
      const { params } = authorizeParams({ redirect_uri: uri });
      const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

      expect(parsed, uri).toMatchObject({ ok: false, kind: 'render' });
      if (parsed.ok || parsed.kind !== 'render') return;
      expect(parsed.error.code).toBe('invalid_redirect_uri');
    }
  });

  it('redirects with an error, state attached, when PKCE is missing or not S256', async () => {
    const store = storeWithClient();

    const cases: Array<Record<string, string | null>> = [
      { code_challenge: null },
      { code_challenge_method: 'plain' },
      { code_challenge_method: null },
      { code_challenge: 'tooshort' },
    ];

    for (const overrides of cases) {
      const { params } = authorizeParams(overrides);
      const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

      expect(parsed, JSON.stringify(overrides)).toMatchObject({
        ok: false,
        kind: 'redirect',
      });
      if (parsed.ok || parsed.kind !== 'redirect') return;

      const location = new URL(parsed.location);
      expect(location.origin + location.pathname).toBe(CALLBACK);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('state')).toBe('xyz');
    }
  });

  it('refuses a scope outside the catalogue and a resource other than the MCP URL', async () => {
    const store = storeWithClient();

    const scope = await parseAuthorizeRequest(
      authorizeParams({ scope: 'studio:read admin:all' }).params,
      { store, resource: RESOURCE },
    );
    expect(scope).toMatchObject({ ok: false, kind: 'redirect' });
    if (scope.ok || scope.kind !== 'redirect') return;
    expect(new URL(scope.location).searchParams.get('error')).toBe('invalid_scope');

    const resource = await parseAuthorizeRequest(
      authorizeParams({ resource: 'https://other.example/api/mcp' }).params,
      { store, resource: RESOURCE },
    );
    expect(resource).toMatchObject({ ok: false, kind: 'redirect' });
    if (resource.ok || resource.kind !== 'redirect') return;
    expect(new URL(resource.location).searchParams.get('error')).toBe('invalid_target');
  });

  it('defaults the scopes to read and write when none are requested, and accepts a trailing slash on the resource', async () => {
    const store = storeWithClient();
    const { params } = authorizeParams({ scope: null, resource: `${RESOURCE}/` });

    const parsed = await parseAuthorizeRequest(params, { store, resource: RESOURCE });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.scopes).toEqual(['studio:read', 'studio:write']);
  });

  it('a denial redirects with access_denied and the state', async () => {
    const store = storeWithClient();
    const parsed = await parseAuthorizeRequest(authorizeParams().params, {
      store,
      resource: RESOURCE,
    });
    if (!parsed.ok) throw new Error('setup');

    const location = new URL(denialLocation(parsed.request));

    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.has('code')).toBe(false);
  });
});

describe('authorization codes', () => {
  it('are stored hashed, expire in 60 seconds and redirect with code and state', async () => {
    const store = storeWithClient();
    const now = new Date('2026-10-03T10:00:00Z');
    const { params } = authorizeParams();

    const issued = await approve(store, params, now);
    const location = new URL(issued.location);

    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(location.searchParams.get('code')).toBe(issued.code);
    expect(location.searchParams.get('state')).toBe('xyz');

    expect(AUTHORIZATION_CODE_TTL_SECONDS).toBe(60);
    expect(store.codes.has(issued.code)).toBe(false);

    const row = store.codes.get(hashToken(issued.code));
    expect(row).toBeDefined();
    expect(row?.expiresAt).toBe('2026-10-03T10:01:00.000Z');
    expect(row?.userId).toBe(USER);
    expect(row?.accountId).toBe(TEAM);
  });
});

describe('/oauth/token authorization_code', () => {
  it('exchanges a code for a 1-hour access token and a 30-day refresh token, both hashed and audience-bound', async () => {
    const store = storeWithClient();
    const now = new Date('2026-10-03T10:00:00Z');
    const { params, codeVerifier } = authorizeParams();
    const { code } = await approve(store, params, now);

    const tokens = await exchange(store, code, codeVerifier, {}, now);

    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 86400);
    expect(tokens.access_token).toMatch(/^sbk_at_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^sbk_rt_[A-Za-z0-9_-]{43}$/);
    expect(tokens.scope).toBe('studio:read studio:write');

    const access = store.tokens.get(hashToken(tokens.access_token));
    const refresh = store.tokens.get(hashToken(tokens.refresh_token!));

    expect(access).toMatchObject({
      kind: 'access',
      audience: RESOURCE,
      expiresAt: '2026-10-03T11:00:00.000Z',
    });
    expect(refresh).toMatchObject({
      kind: 'refresh',
      audience: RESOURCE,
      expiresAt: '2026-11-02T10:00:00.000Z',
    });

    const connection = store.connections.get(access!.connectionId);
    expect(connection).toMatchObject({
      kind: 'oauth',
      clientId: 'claude',
      name: 'Claude',
      userId: USER,
      accountId: TEAM,
      scopes: ['studio:read', 'studio:write'],
    });
  });

  it('refuses the same code twice: the second use fails and nothing more is issued', async () => {
    const store = storeWithClient();
    const { params, codeVerifier } = authorizeParams();
    const { code } = await approve(store, params);

    await exchange(store, code, codeVerifier);
    const error = await refusal(exchange(store, code, codeVerifier));

    expect(error.code).toBe('invalid_grant');
    expect(store.tokens.size).toBe(2);
  });

  it('refuses a wrong verifier, a different redirect URI, another client and another resource', async () => {
    const store = storeWithClient();

    for (const [overrides, useVerifier] of [
      [{}, verifier()],
      [{ redirect_uri: 'http://localhost:9999/cb' }, undefined],
      [{ client_id: 'someone-else' }, undefined],
      [{ resource: 'https://other.example/api/mcp' }, undefined],
      [{ code_verifier: null }, undefined],
    ] as Array<[Record<string, string | null>, string | undefined]>) {
      const { params, codeVerifier } = authorizeParams();
      const { code } = await approve(store, params);

      const error = await refusal(
        exchange(store, code, useVerifier ?? codeVerifier, overrides),
      );

      expect(['invalid_grant', 'invalid_target', 'invalid_request', 'invalid_client']).toContain(
        error.code,
      );
    }

    expect(store.tokens.size).toBe(0);
  });

  it('refuses a code older than 60 seconds', async () => {
    const store = storeWithClient();
    const issuedAt = new Date('2026-10-03T10:00:00Z');
    const { params, codeVerifier } = authorizeParams();
    const { code } = await approve(store, params, issuedAt);

    const error = await refusal(
      exchange(store, code, codeVerifier, {}, new Date('2026-10-03T10:01:01Z')),
    );

    expect(error.code).toBe('invalid_grant');
  });

  it('refuses an unknown grant type', async () => {
    const store = storeWithClient();
    const params = new URLSearchParams({ grant_type: 'password', client_id: 'claude' });

    const error = await refusal(
      handleTokenRequest(params, { store, resource: RESOURCE }),
    );

    expect(error.code).toBe('unsupported_grant_type');
  });
});

describe('/oauth/token refresh_token', () => {
  async function connected(now: Date) {
    const store = storeWithClient();
    const { params, codeVerifier } = authorizeParams();
    const { code } = await approve(store, params, now);
    const tokens = await exchange(store, code, codeVerifier, {}, now);

    return { store, tokens };
  }

  function refresh(
    store: OAuthStore,
    refreshToken: string,
    now: Date,
    overrides: Record<string, string | null> = {},
  ) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'claude',
      resource: RESOURCE,
    });

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }

    return handleTokenRequest(params, { store, resource: RESOURCE, now: () => now });
  }

  it('rotates: a new pair is issued, the old refresh token is revoked and named as rotated_from', async () => {
    const t0 = new Date('2026-10-03T10:00:00Z');
    const { store, tokens } = await connected(t0);
    const t1 = new Date('2026-10-03T10:30:00Z');

    const next = await refresh(store, tokens.refresh_token!, t1);

    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    const oldRefresh = store.tokens.get(hashToken(tokens.refresh_token!));
    const newRefresh = store.tokens.get(hashToken(next.refresh_token!));

    expect(oldRefresh?.revokedAt).toBe(t1.toISOString());
    expect(newRefresh?.rotatedFrom).toBe(hashToken(tokens.refresh_token!));
    expect(newRefresh?.connectionId).toBe(oldRefresh?.connectionId);
  });

  it('reuse of a rotated refresh token revokes the whole connection', async () => {
    const t0 = new Date('2026-10-03T10:00:00Z');
    const { store, tokens } = await connected(t0);
    const t1 = new Date('2026-10-03T10:30:00Z');
    const next = await refresh(store, tokens.refresh_token!, t1);

    const error = await refusal(
      refresh(store, tokens.refresh_token!, new Date('2026-10-03T10:31:00Z')),
    );

    expect(error.code).toBe('invalid_grant');

    const connectionId = store.tokens.get(hashToken(next.access_token))!.connectionId;
    expect(store.connections.get(connectionId)?.revokedAt).not.toBeNull();
    expect(store.tokens.get(hashToken(next.access_token))?.revokedAt).not.toBeNull();
    expect(store.tokens.get(hashToken(next.refresh_token!))?.revokedAt).not.toBeNull();
  });

  it('refuses an expired refresh token, a revoked connection, another client and another resource', async () => {
    const t0 = new Date('2026-10-03T10:00:00Z');

    const expired = await connected(t0);
    expect(
      (await refusal(
        refresh(expired.store, expired.tokens.refresh_token!, new Date('2026-11-03T10:00:00Z')),
      )).code,
    ).toBe('invalid_grant');

    const revoked = await connected(t0);
    const connectionId = revoked.store.tokens.get(
      hashToken(revoked.tokens.access_token),
    )!.connectionId;
    await revoked.store.revokeConnection(connectionId, t0);
    expect(
      (await refusal(refresh(revoked.store, revoked.tokens.refresh_token!, t0))).code,
    ).toBe('invalid_grant');

    const otherClient = await connected(t0);
    expect(
      (await refusal(
        refresh(otherClient.store, otherClient.tokens.refresh_token!, t0, {
          client_id: 'someone-else',
        }),
      )).code,
    ).toBe('invalid_grant');

    const otherResource = await connected(t0);
    expect(
      (await refusal(
        refresh(otherResource.store, otherResource.tokens.refresh_token!, t0, {
          resource: 'https://other.example/api/mcp',
        }),
      )).code,
    ).toBe('invalid_target');
  });

  it('an access token is not a refresh token', async () => {
    const t0 = new Date('2026-10-03T10:00:00Z');
    const { store, tokens } = await connected(t0);

    const error = await refusal(refresh(store, tokens.access_token, t0));

    expect(error.code).toBe('invalid_grant');
  });
});

describe('/oauth/revoke', () => {
  it('revokes an access token alone, and a refresh token with its whole connection; unknown tokens are fine', async () => {
    const store = storeWithClient();
    const now = new Date('2026-10-03T10:00:00Z');
    const { params, codeVerifier } = authorizeParams();
    const { code } = await approve(store, params, now);
    const tokens = await exchange(store, code, codeVerifier, {}, now);

    await handleRevokeRequest(new URLSearchParams({ token: tokens.access_token }), {
      store,
      now: () => now,
    });

    expect(store.tokens.get(hashToken(tokens.access_token))?.revokedAt).toBe(now.toISOString());
    expect(store.tokens.get(hashToken(tokens.refresh_token!))?.revokedAt).toBeNull();

    await handleRevokeRequest(
      new URLSearchParams({ token: tokens.refresh_token!, token_type_hint: 'refresh_token' }),
      { store, now: () => now },
    );

    const connectionId = store.tokens.get(hashToken(tokens.access_token))!.connectionId;
    expect(store.connections.get(connectionId)?.revokedAt).toBe(now.toISOString());

    await expect(
      handleRevokeRequest(new URLSearchParams({ token: 'sbk_at_' + 'x'.repeat(43) }), {
        store,
        now: () => now,
      }),
    ).resolves.toBeUndefined();
  });
});
