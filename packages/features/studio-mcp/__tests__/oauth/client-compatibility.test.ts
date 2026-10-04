import { describe, expect, it } from 'vitest';

import { registerClient, resolveClient } from '../../src/server/oauth/clients';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../../src/server/oauth/metadata';
import { createMemoryOAuthStore } from '../../src/server/oauth/store';
import { createMcpRouteHandlers } from '../../src/server/route-handler';

/**
 * Claude and ChatGPT as they actually present themselves (FILM-1911): both
 * pick a client metadata document as their client_id when the
 * authorization server advertises one, so their real documents must
 * resolve. Both documents are copied verbatim from what their URLs served
 * on 2026-10-04.
 */
const CLAUDE_DOC = {
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: [
    'authorization_code',
    'refresh_token',
    'urn:ietf:params:oauth:grant-type:jwt-bearer',
  ],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

const CHATGPT_DOC = {
  client_id: 'https://chatgpt.com/oauth/client.json',
  client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png',
  token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};

const NOW = new Date('2026-10-04T10:00:00Z');

function serving(body: Record<string, unknown>) {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

describe('the published client documents of Claude and ChatGPT', () => {
  it.each([
    ['Claude', CLAUDE_DOC],
    ['ChatGPT', CHATGPT_DOC],
  ])(
    "%s's document resolves to a public client held to its redirect URI",
    async (name, doc) => {
      const store = createMemoryOAuthStore();

      const client = await resolveClient(store, doc.client_id, {
        fetchFn: serving(doc),
        now: NOW,
      });

      expect(client).toEqual({
        clientId: doc.client_id,
        clientName: name,
        redirectUris: doc.redirect_uris,
        metadataUrl: doc.client_id,
        createdAt: NOW.toISOString(),
      });
    },
  );

  it('a document whose client can only authenticate with a key or a secret is refused', async () => {
    for (const methods of [
      { token_endpoint_auth_method: 'private_key_jwt' },
      {
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_methods_supported: ['private_key_jwt'],
      },
      { token_endpoint_auth_method: 'client_secret_basic' },
    ]) {
      const store = createMemoryOAuthStore();
      const doc = {
        client_id: 'https://client.example/oauth/client.json',
        client_name: 'Keyed',
        redirect_uris: ['https://client.example/cb'],
        ...methods,
      };

      expect(
        await resolveClient(store, doc.client_id, {
          fetchFn: serving(doc),
          now: NOW,
        }),
        JSON.stringify(methods),
      ).toBeNull();
    }
  });

  it('a document without the authorization_code grant is refused', async () => {
    const store = createMemoryOAuthStore();
    const doc = {
      client_id: 'https://client.example/oauth/client.json',
      redirect_uris: ['https://client.example/cb'],
      grant_types: ['client_credentials', 'refresh_token'],
    };

    expect(
      await resolveClient(store, doc.client_id, {
        fetchFn: serving(doc),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe('Dynamic Client Registration with metadata like those documents', () => {
  it('registers a client that can act as a public client as one, and answers with only the grants it will get (RFC 7591 §3.2.1)', async () => {
    const store = createMemoryOAuthStore();

    const registered = await registerClient(
      store,
      {
        client_name: 'ChatGPT',
        redirect_uris: [
          'https://chatgpt.com/connector_platform_oauth_redirect',
        ],
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        ],
      },
      { now: NOW },
    );

    expect(registered.token_endpoint_auth_method).toBe('none');
    expect(registered.grant_types).toEqual([
      'authorization_code',
      'refresh_token',
    ]);
    expect(registered).not.toHaveProperty('client_secret');
    expect(store.clients.get(registered.client_id)?.redirectUris).toEqual([
      'https://chatgpt.com/connector_platform_oauth_redirect',
    ]);
  });
});

describe('issuer identification (RFC 9207)', () => {
  it('the authorization server says it returns iss, under the exact issuer the protected resource names', () => {
    const origin = 'https://app.storybook.example';
    const as = authorizationServerMetadata({ issuer: `${origin}/` });
    const prm = protectedResourceMetadata({
      resource: `${origin}/api/mcp`,
      authorizationServer: origin,
    });

    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.issuer).toBe(origin);
    expect(prm.authorization_servers[0]).toBe(as.issuer);
  });
});

describe('browser origins /api/mcp answers by default', () => {
  it.each(['https://claude.ai', 'https://chatgpt.com'])(
    'a preflight from %s is allowed; another origin gets no CORS headers',
    async (origin) => {
      delete process.env.MCP_ALLOWED_ORIGINS;
      const { OPTIONS } = createMcpRouteHandlers();
      const preflight = (from: string) =>
        OPTIONS(
          new Request('https://app.storybook.example/api/mcp', {
            method: 'OPTIONS',
            headers: { Origin: from },
          }),
        );

      expect(
        (await preflight(origin)).headers.get('Access-Control-Allow-Origin'),
      ).toBe(origin);
      expect(
        (await preflight('https://evil.example')).headers.get(
          'Access-Control-Allow-Origin',
        ),
      ).toBeNull();
    },
  );
});
