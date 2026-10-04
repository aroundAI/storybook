import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseAuthorizeRequest } from '../../src/server/oauth/authorize';
import { registerClient, resolveClient } from '../../src/server/oauth/clients';
import { OAuthError } from '../../src/server/oauth/errors';
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from '../../src/server/oauth/metadata';
import { handleRevokeRequest } from '../../src/server/oauth/revoke';
import { createMemoryOAuthStore } from '../../src/server/oauth/store';
import { handleTokenRequest } from '../../src/server/oauth/token';
import { createMcpRouteHandlers } from '../../src/server/route-handler';

/**
 * Claude and ChatGPT as they actually present themselves (FILM-1911,
 * KB-185): both pick a client metadata document as their client_id when the
 * authorization server advertises one, so their real documents must
 * resolve. fixtures/ holds the bytes each URL served on 2026-10-04.
 */
function fixture(name: string) {
  const text = readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    'utf8',
  );

  return {
    text,
    doc: JSON.parse(text) as Record<string, unknown> & {
      client_id: string;
      redirect_uris: string[];
    },
  };
}

const CLAUDE = fixture('claude-client-metadata.2026-10-04.json');
const CHATGPT = fixture('chatgpt-client-metadata.2026-10-04.json');

const NOW = new Date('2026-10-04T10:00:00Z');

function serving(body: Record<string, unknown> | string) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

describe('the published client documents of Claude and ChatGPT', () => {
  it.each([
    ['Claude', CLAUDE],
    ['ChatGPT', CHATGPT],
  ])(
    "%s's document resolves to a public client held to its redirect URI",
    async (name, { text, doc }) => {
      const store = createMemoryOAuthStore();

      const client = await resolveClient(store, doc.client_id, {
        fetchFn: serving(text),
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

  it('a document whose client can only authenticate with a key or a secret is refused with invalid_client naming its method', async () => {
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

      await expect(
        resolveClient(store, doc.client_id, {
          fetchFn: serving(doc),
          now: NOW,
        }),
        JSON.stringify(methods),
      ).rejects.toMatchObject({
        code: 'invalid_client',
        message: expect.stringContaining(methods.token_endpoint_auth_method),
      });
      expect(store.clients.size).toBe(0);
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

describe('a credential a client presents is refused, never ignored', () => {
  const RESOURCE = 'https://app.storybook.example/api/mcp';
  const ASSERTION = {
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: 'eyJhbGciOiJSUzI1NiJ9.e30.c2ln',
  };

  async function refusal(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      if (error instanceof OAuthError) return error;
      throw error;
    }

    throw new Error('expected an OAuthError');
  }

  it.each([
    ['a client_assertion (private_key_jwt)', ASSERTION, null],
    ['a client_secret', { client_secret: 's3cret' }, null],
    [
      'an Authorization header (client_secret_basic)',
      {},
      'Basic Y2xpZW50OnNlY3JldA==',
    ],
  ])(
    'the token endpoint answers invalid_client to %s, before looking at the grant',
    async (_what, extra, authorizationHeader) => {
      const store = createMemoryOAuthStore();

      const grants: Array<Record<string, string>> = [
        { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' },
        { grant_type: 'refresh_token', refresh_token: 'r' },
      ];

      for (const grant of grants) {
        const error = await refusal(
          handleTokenRequest(
            new URLSearchParams({
              ...grant,
              client_id: CHATGPT.doc.client_id,
              ...extra,
            }),
            { store, resource: RESOURCE, authorizationHeader },
          ),
        );

        expect(error.code).toBe('invalid_client');
        expect(error.status).toBe(401);
        expect(error.message).toMatch(/PKCE/);
      }

      expect(store.tokens.size).toBe(0);
    },
  );

  it('the revoke endpoint answers invalid_client to a client_assertion or an Authorization header', async () => {
    const store = createMemoryOAuthStore();

    for (const [extra, authorizationHeader] of [
      [ASSERTION, null],
      [{}, 'Basic Y2xpZW50OnNlY3JldA=='],
    ] as const) {
      const error = await refusal(
        handleRevokeRequest(new URLSearchParams({ token: 't', ...extra }), {
          store,
          authorizationHeader,
        }),
      );

      expect(error.code).toBe('invalid_client');
    }
  });

  it('a document whose only method is private_key_jwt is refused on our page with a clear reason, never redirected to', async () => {
    const store = createMemoryOAuthStore();
    const keyOnly = {
      ...CHATGPT.doc,
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
    };

    const parsed = await parseAuthorizeRequest(
      new URLSearchParams({
        response_type: 'code',
        client_id: keyOnly.client_id,
        redirect_uri: keyOnly.redirect_uris[0]!,
        code_challenge: 'E'.repeat(43),
        code_challenge_method: 'S256',
      }),
      {
        store,
        resource: RESOURCE,
        issuer: 'https://app.storybook.example',
        fetchFn: serving(keyOnly),
      },
    );

    expect(parsed).toMatchObject({ ok: false, kind: 'render' });
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('invalid_client');
    expect(parsed.error.message).toMatch(/private_key_jwt/);
    expect(store.clients.size).toBe(0);
  });
});

describe('a cached client document is refreshed', () => {
  const HOUR = 3_600_000;

  function cachedChatGpt(ageHours: number) {
    const store = createMemoryOAuthStore();

    store.clients.set(CHATGPT.doc.client_id, {
      clientId: CHATGPT.doc.client_id,
      clientName: 'ChatGPT',
      redirectUris: ['https://chatgpt.com/old_redirect'],
      metadataUrl: CHATGPT.doc.client_id,
      createdAt: new Date(NOW.getTime() - ageHours * HOUR).toISOString(),
    });

    return store;
  }

  function counting(fetchFn: () => Promise<Response>) {
    const calls: string[] = [];
    const wrapped = async (input: string | URL | Request) => {
      calls.push(String(input));

      return fetchFn();
    };

    return { calls, fetchFn: wrapped };
  }

  it('a copy younger than a day is used as it is', async () => {
    const store = cachedChatGpt(23);
    const { calls, fetchFn } = counting(serving(CHATGPT.text));

    const client = await resolveClient(store, CHATGPT.doc.client_id, {
      fetchFn,
      now: NOW,
    });

    expect(calls).toEqual([]);
    expect(client?.redirectUris).toEqual(['https://chatgpt.com/old_redirect']);
  });

  it('an older copy is fetched again, so a rotated redirect URI takes effect', async () => {
    const store = cachedChatGpt(25);
    const { calls, fetchFn } = counting(serving(CHATGPT.text));

    const client = await resolveClient(store, CHATGPT.doc.client_id, {
      fetchFn,
      now: NOW,
    });

    expect(calls).toEqual([CHATGPT.doc.client_id]);
    expect(client?.redirectUris).toEqual(CHATGPT.doc.redirect_uris);
    expect(store.clients.get(CHATGPT.doc.client_id)).toMatchObject({
      redirectUris: CHATGPT.doc.redirect_uris,
      createdAt: NOW.toISOString(),
    });
  });

  it('when the refetch fails, the cached copy is kept and used', async () => {
    const store = cachedChatGpt(25);
    const { calls, fetchFn } = counting(
      async () => new Response('down', { status: 503 }),
    );

    const client = await resolveClient(store, CHATGPT.doc.client_id, {
      fetchFn,
      now: NOW,
    });

    expect(calls).toHaveLength(1);
    expect(client?.redirectUris).toEqual(['https://chatgpt.com/old_redirect']);
  });

  it('a registered (DCR) client is never refetched, however old', async () => {
    const store = createMemoryOAuthStore();
    store.clients.set('sbk_client_x', {
      clientId: 'sbk_client_x',
      clientName: 'x',
      redirectUris: ['https://x.example/cb'],
      metadataUrl: null,
      createdAt: new Date(NOW.getTime() - 400 * HOUR).toISOString(),
    });
    const { calls, fetchFn } = counting(serving(CHATGPT.text));

    expect(
      await resolveClient(store, 'sbk_client_x', { fetchFn, now: NOW }),
    ).not.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('client documents from the vendor sandbox', () => {
  const SANDBOX = {
    NODE_ENV: 'test',
    VENDOR_SANDBOX: '1',
    VENDOR_URL_CLIENTDOCS: 'http://127.0.0.1:4100/__sandbox/client-documents',
  };

  it('with the sandbox on, the document is read from it, keyed by the client id', async () => {
    const store = createMemoryOAuthStore();
    const calls: string[] = [];

    const client = await resolveClient(store, CHATGPT.doc.client_id, {
      fetchFn: async (input) => {
        calls.push(String(input));
        return serving(CHATGPT.text)();
      },
      now: NOW,
      env: SANDBOX,
    });

    expect(calls).toEqual([
      `http://127.0.0.1:4100/__sandbox/client-documents/${encodeURIComponent(CHATGPT.doc.client_id)}`,
    ]);
    expect(client?.clientId).toBe(CHATGPT.doc.client_id);
  });

  it('with the sandbox off (production), the override is never read', async () => {
    const store = createMemoryOAuthStore();
    const calls: string[] = [];

    await resolveClient(store, CHATGPT.doc.client_id, {
      fetchFn: async (input) => {
        calls.push(String(input));
        return serving(CHATGPT.text)();
      },
      now: NOW,
      env: { ...SANDBOX, NODE_ENV: 'production' },
    });

    expect(calls).toEqual([CHATGPT.doc.client_id]);
  });
});
