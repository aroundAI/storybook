import { describe, expect, it } from 'vitest';

import {
  isAllowedRedirectUri,
  registerClient,
  resolveClient,
} from '../../src/server/oauth/clients';
import { OAuthError } from '../../src/server/oauth/errors';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../../src/server/oauth/metadata';
import { createMemoryOAuthStore } from '../../src/server/oauth/store';

const NOW = new Date('2026-10-03T10:00:00Z');

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error;
    throw error;
  }

  throw new Error('expected an OAuthError');
}

describe('redirect URIs a client may register', () => {
  it('allows https, loopback http and private-use schemes; refuses other http and fragments', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:8080/cb')).toBe(true);
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/callback')).toBe(true);

    expect(isAllowedRedirectUri('http://example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
  });
});

describe('POST /oauth/register (RFC 7591)', () => {
  it('registers a public client and answers with its id and the metadata it will be held to', async () => {
    const store = createMemoryOAuthStore();

    const registered = await registerClient(
      store,
      {
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { now: NOW },
    );

    expect(registered.client_id).toMatch(/^sbk_client_[A-Za-z0-9_-]{32}$/);
    expect(registered.client_id_issued_at).toBe(Math.floor(NOW.getTime() / 1000));
    expect(registered.client_name).toBe('Claude');
    expect(registered.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(registered.token_endpoint_auth_method).toBe('none');
    expect(registered.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(registered).not.toHaveProperty('client_secret');

    const stored = store.clients.get(registered.client_id);
    expect(stored?.clientName).toBe('Claude');
    expect(stored?.metadataUrl).toBeNull();
  });

  it('names an unnamed client after its first redirect host', async () => {
    const store = createMemoryOAuthStore();

    const registered = await registerClient(
      store,
      { redirect_uris: ['http://localhost:6274/oauth/callback'] },
      { now: NOW },
    );

    expect(registered.client_name).toBe('localhost');
  });

  it('refuses a missing or forbidden redirect URI, a client secret method, and other grant types', async () => {
    const store = createMemoryOAuthStore();

    expect(
      (await refusal(registerClient(store, { client_name: 'x' }, { now: NOW }))).code,
    ).toBe('invalid_redirect_uri');

    expect(
      (await refusal(
        registerClient(store, { redirect_uris: ['http://example.com/cb'] }, { now: NOW }),
      )).code,
    ).toBe('invalid_redirect_uri');

    expect(
      (await refusal(
        registerClient(
          store,
          {
            redirect_uris: ['https://claude.ai/cb'],
            token_endpoint_auth_method: 'client_secret_basic',
          },
          { now: NOW },
        ),
      )).code,
    ).toBe('invalid_client_metadata');

    expect(
      (await refusal(
        registerClient(
          store,
          { redirect_uris: ['https://claude.ai/cb'], grant_types: ['client_credentials'] },
          { now: NOW },
        ),
      )).code,
    ).toBe('invalid_client_metadata');

    expect(store.clients.size).toBe(0);
  });
});

describe('client metadata documents as client_id', () => {
  const DOC_URL = 'https://claude.ai/.well-known/oauth-client';

  function fetchReturning(body: unknown, status = 200, contentType = 'application/json') {
    const calls: string[] = [];
    const fetchFn = async (input: string | URL | Request) => {
      calls.push(String(input));

      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': contentType },
      });
    };

    return { fetchFn, calls };
  }

  it('fetches the document once, validates it and caches the client under its URL', async () => {
    const store = createMemoryOAuthStore();
    const { fetchFn, calls } = fetchReturning({
      client_id: DOC_URL,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
    });

    const first = await resolveClient(store, DOC_URL, { fetchFn, now: NOW });
    const second = await resolveClient(store, DOC_URL, { fetchFn, now: NOW });

    expect(first?.clientName).toBe('Claude');
    expect(first?.metadataUrl).toBe(DOC_URL);
    expect(first?.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(second).toEqual(first);
    expect(calls).toEqual([DOC_URL]);
  });

  it('refuses a document whose client_id is not its own URL, or that is not https, or that names a bad redirect', async () => {
    const store = createMemoryOAuthStore();

    const mismatched = fetchReturning({
      client_id: 'https://elsewhere.example/client',
      redirect_uris: ['https://claude.ai/cb'],
    });
    expect(await resolveClient(store, DOC_URL, { fetchFn: mismatched.fetchFn, now: NOW })).toBeNull();

    const plain = fetchReturning({ client_id: 'http://claude.ai/c', redirect_uris: ['https://claude.ai/cb'] });
    expect(await resolveClient(store, 'http://claude.ai/c', { fetchFn: plain.fetchFn, now: NOW })).toBeNull();
    expect(plain.calls).toEqual([]);

    const badRedirect = fetchReturning({ client_id: DOC_URL, redirect_uris: ['http://example.com/cb'] });
    expect(await resolveClient(store, DOC_URL, { fetchFn: badRedirect.fetchFn, now: NOW })).toBeNull();

    const notFound = fetchReturning({}, 404);
    expect(await resolveClient(store, DOC_URL, { fetchFn: notFound.fetchFn, now: NOW })).toBeNull();

    expect(store.clients.size).toBe(0);
  });

  it('never fetches a loopback or private address', async () => {
    const store = createMemoryOAuthStore();
    const { fetchFn, calls } = fetchReturning({});

    for (const url of [
      'https://localhost/client',
      'https://127.0.0.1/client',
      'https://10.0.0.4/client',
      'https://192.168.1.2/client',
      'https://[::1]/client',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect(await resolveClient(store, url, { fetchFn, now: NOW }), url).toBeNull();
    }

    expect(calls).toEqual([]);
  });

  it('a plain unknown client id is not fetched', async () => {
    const store = createMemoryOAuthStore();
    const { fetchFn, calls } = fetchReturning({});

    expect(await resolveClient(store, 'sbk_client_nobody', { fetchFn, now: NOW })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('discovery metadata', () => {
  const ORIGIN = 'https://app.storybook.example';

  it('protected-resource metadata names the MCP URL, the configured authorization server and the scopes', () => {
    const own = protectedResourceMetadata({
      resource: `${ORIGIN}/api/mcp`,
      authorizationServer: ORIGIN,
    });

    expect(own.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(own.authorization_servers).toEqual([ORIGIN]);
    expect(own.scopes_supported).toEqual(['studio:read', 'studio:write', 'studio:render']);
    expect(own.bearer_methods_supported).toEqual(['header']);

    const supabase = protectedResourceMetadata({
      resource: `${ORIGIN}/api/mcp`,
      authorizationServer: 'https://xyz.supabase.co/auth/v1',
    });

    expect(supabase.authorization_servers).toEqual(['https://xyz.supabase.co/auth/v1']);
  });

  it('authorization-server metadata publishes the four endpoints, S256 only, the scopes, both grant types and no client authentication', () => {
    const metadata = authorizationServerMetadata({ issuer: ORIGIN });

    expect(metadata.issuer).toBe(ORIGIN);
    expect(metadata.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(metadata.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(metadata.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(metadata.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.scopes_supported).toEqual(['studio:read', 'studio:write', 'studio:render']);
    expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(metadata.response_types_supported).toEqual(['code']);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(['none']);
    expect(metadata.client_id_metadata_document_supported).toBe(true);
  });
});
