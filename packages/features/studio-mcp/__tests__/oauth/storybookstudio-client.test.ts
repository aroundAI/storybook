import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  STORYBOOKSTUDIO_CLIENT_ID,
  STORYBOOKSTUDIO_CLIENT_NAME,
  STORYBOOKSTUDIO_REDIRECT_URI,
  requiresDesktopIntegration,
} from '../../src/desktop-client';
import {
  issueAuthorizationCode,
  parseAuthorizeRequest,
} from '../../src/server/oauth/authorize';
import { OAuthError } from '../../src/server/oauth/errors';
import { codeChallengeFor } from '../../src/server/oauth/pkce';
import { createMemoryOAuthStore } from '../../src/server/oauth/store';
import { handleTokenRequest } from '../../src/server/oauth/token';

/**
 * FILM-2005: StorybookStudio is one more client of FILM-1907's server. Its
 * row is seeded by a migration (here, by hand into the memory store, with
 * the same values); the only rule it changes is that this client, and no
 * other, may be sent back to a loopback port (RFC 8252 §7.3).
 */
const RESOURCE = 'http://localhost:3000/api/mcp';
const ISSUER = 'http://localhost:3000';
const USER = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const LOOPBACK = 'http://127.0.0.1:53682/callback';

function store() {
  const memory = createMemoryOAuthStore();

  memory.clients.set(STORYBOOKSTUDIO_CLIENT_ID, {
    clientId: STORYBOOKSTUDIO_CLIENT_ID,
    clientName: STORYBOOKSTUDIO_CLIENT_NAME,
    redirectUris: [STORYBOOKSTUDIO_REDIRECT_URI],
    metadataUrl: null,
    createdAt: new Date().toISOString(),
  });

  // Any other client, registered with the very loopback URI the Studio uses
  // but on a fixed port
  memory.clients.set('other', {
    clientId: 'other',
    clientName: 'Other',
    redirectUris: ['http://127.0.0.1:9999/callback'],
    metadataUrl: null,
    createdAt: new Date().toISOString(),
  });

  return memory;
}

function authorizeParams(
  clientId: string,
  redirectUri: string,
  verifier = randomBytes(32).toString('base64url'),
) {
  return {
    verifier,
    params: new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallengeFor(verifier),
      code_challenge_method: 'S256',
      scope: 'studio:read studio:write studio:render',
      state: 'st',
      resource: RESOURCE,
    }),
  };
}

async function parse(
  memory: ReturnType<typeof store>,
  clientId: string,
  redirectUri: string,
) {
  return parseAuthorizeRequest(authorizeParams(clientId, redirectUri).params, {
    store: memory,
    resource: RESOURCE,
    issuer: ISSUER,
  });
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

describe('the StorybookStudio redirect rule', () => {
  it.each([
    ['the custom scheme it registered', STORYBOOKSTUDIO_REDIRECT_URI],
    ['a loopback callback on a high port', LOOPBACK],
    ['a loopback callback on port 1', 'http://127.0.0.1:1/callback'],
    ['a loopback callback on port 65535', 'http://127.0.0.1:65535/callback'],
  ])('accepts %s', async (_label, uri) => {
    const parsed = await parse(store(), STORYBOOKSTUDIO_CLIENT_ID, uri);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.request.redirectUri).toBe(uri);
  });

  it.each([
    ['no port', 'http://127.0.0.1/callback'],
    ['port 0', 'http://127.0.0.1:0/callback'],
    ['a port above 65535', 'http://127.0.0.1:65536/callback'],
    ['a port with a leading zero', 'http://127.0.0.1:08080/callback'],
    ['localhost instead of the IP literal', 'http://localhost:53682/callback'],
    ['another loopback address', 'http://127.0.0.2:53682/callback'],
    ['IPv6 loopback', 'http://[::1]:53682/callback'],
    ['https', 'https://127.0.0.1:53682/callback'],
    ['another path', 'http://127.0.0.1:53682/cb'],
    ['a trailing slash', 'http://127.0.0.1:53682/callback/'],
    ['a deeper path', 'http://127.0.0.1:53682/callback/x'],
    ['a query', 'http://127.0.0.1:53682/callback?next=x'],
    ['a fragment', 'http://127.0.0.1:53682/callback#x'],
    ['userinfo pointing elsewhere', 'http://127.0.0.1:80@evil.test/callback'],
    [
      'a host that starts with the IP',
      'http://127.0.0.1.evil.test:80/callback',
    ],
    ['another custom-scheme path', 'storybookstudio://auth/callback2'],
    ['another custom scheme', 'evil://auth/callback'],
  ])('refuses %s, on our page and never as a redirect', async (_label, uri) => {
    const parsed = await parse(store(), STORYBOOKSTUDIO_CLIENT_ID, uri);

    expect(parsed).toMatchObject({
      ok: false,
      kind: 'render',
      error: { code: 'invalid_redirect_uri' },
    });
  });

  it('keeps the exact-match rule for every other client: its own port only', async () => {
    const memory = store();

    expect(
      (await parse(memory, 'other', 'http://127.0.0.1:9999/callback')).ok,
    ).toBe(true);
    expect(await parse(memory, 'other', LOOPBACK)).toMatchObject({
      ok: false,
      kind: 'render',
      error: { code: 'invalid_redirect_uri' },
    });
  });

  it('only this client needs the team to have the desktop integration on', () => {
    expect(requiresDesktopIntegration(STORYBOOKSTUDIO_CLIENT_ID)).toBe(true);
    expect(requiresDesktopIntegration('other')).toBe(false);
    expect(requiresDesktopIntegration('StorybookStudio')).toBe(false);
  });
});

describe('the StorybookStudio grant', () => {
  async function codeFor(
    memory: ReturnType<typeof store>,
    redirectUri = LOOPBACK,
  ) {
    const { params, verifier } = authorizeParams(
      STORYBOOKSTUDIO_CLIENT_ID,
      redirectUri,
    );
    const parsed = await parseAuthorizeRequest(params, {
      store: memory,
      resource: RESOURCE,
      issuer: ISSUER,
    });

    if (!parsed.ok) throw new Error(`refused: ${JSON.stringify(parsed)}`);

    const { code, location } = await issueAuthorizationCode(memory, {
      request: parsed.request,
      userId: USER,
      accountId: TEAM,
      scopes: parsed.request.scopes,
    });

    return { code, location: new URL(location), verifier };
  }

  function exchange(
    memory: ReturnType<typeof store>,
    input: {
      code: string;
      verifier: string;
      redirectUri?: string;
      clientName?: string;
    },
  ) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: STORYBOOKSTUDIO_CLIENT_ID,
      redirect_uri: input.redirectUri ?? LOOPBACK,
      code_verifier: input.verifier,
      resource: RESOURCE,
    });

    if (input.clientName !== undefined) {
      params.set('client_name', input.clientName);
    }

    return handleTokenRequest(params, { store: memory, resource: RESOURCE });
  }

  it('sends the code to the loopback port the request named', async () => {
    const { location } = await codeFor(store());

    expect(location.origin).toBe('http://127.0.0.1:53682');
    expect(location.pathname).toBe('/callback');
    expect(location.searchParams.get('state')).toBe('st');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('names the connection after the device the token request names', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);

    const tokens = await exchange(memory, {
      code,
      verifier,
      clientName: 'Shaurya’s MacBook',
    });

    expect(tokens.access_token).toMatch(/^sbk_at_/);
    expect(tokens.refresh_token).toMatch(/^sbk_rt_/);
    expect(tokens.scope).toBe('studio:read studio:write studio:render');

    const [connection] = [...memory.connections.values()];
    expect(connection).toMatchObject({
      clientId: STORYBOOKSTUDIO_CLIENT_ID,
      name: 'Shaurya’s MacBook',
      accountId: TEAM,
    });
  });

  it('falls back to the client record when no device name is sent', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);

    await exchange(memory, { code, verifier });

    expect([...memory.connections.values()][0]?.name).toBe(
      STORYBOOKSTUDIO_CLIENT_NAME,
    );
  });

  it('a blank device name falls back too, and control characters never reach the name', async () => {
    const memory = store();
    const first = await codeFor(memory);
    await exchange(memory, { ...first, clientName: ' \u0000\t ' });

    const second = await codeFor(memory);
    await exchange(memory, { ...second, clientName: 'Studio\u0007\nbox‮' });

    const names = [...memory.connections.values()].map((c) => c.name);
    expect(names).toEqual([STORYBOOKSTUDIO_CLIENT_NAME, 'Studio box']);
  });

  it('a device name longer than a connection name allows is cut to 100 characters', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);

    await exchange(memory, { code, verifier, clientName: '😀'.repeat(150) });

    const name = [...memory.connections.values()][0]!.name;
    expect(Array.from(name)).toHaveLength(100);
    expect(name).toBe('😀'.repeat(100));
  });

  it('a code is redeemed once: the second exchange is refused (FILM-1907)', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);

    await exchange(memory, { code, verifier, clientName: 'Mac' });

    const error = await refusal(exchange(memory, { code, verifier }));
    expect(error.code).toBe('invalid_grant');
    expect(error.message).toBe('This authorization code was already used.');
  });

  it('the exchange must name the same loopback port as the request', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);

    const error = await refusal(
      exchange(memory, {
        code,
        verifier,
        redirectUri: 'http://127.0.0.1:53683/callback',
      }),
    );
    expect(error.code).toBe('invalid_grant');
  });

  it('revoking the connection logs the device out: its refresh token is refused', async () => {
    const memory = store();
    const { code, verifier } = await codeFor(memory);
    const tokens = await exchange(memory, {
      code,
      verifier,
      clientName: 'Mac',
    });
    const [connection] = [...memory.connections.values()];

    await memory.revokeConnection(connection!.id, new Date());

    const error = await refusal(
      handleTokenRequest(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token!,
          client_id: STORYBOOKSTUDIO_CLIENT_ID,
          resource: RESOURCE,
        }),
        { store: memory, resource: RESOURCE },
      ),
    );
    expect(error.code).toBe('invalid_grant');
    expect(
      [...memory.tokens.values()].every((token) => token.revokedAt !== null),
    ).toBe(true);
  });
});
