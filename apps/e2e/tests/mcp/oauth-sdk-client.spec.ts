import {
  type OAuthClientProvider,
  auth,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { expect, test } from '@playwright/test';

import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { CALLBACK_PATH, CALLBACK_URL, MCP_URL } from './oauth-client';

/**
 * FILM-1907 integration: the MCP SDK's own OAuth client (what Claude and
 * the Inspector run) completes discovery, Dynamic Client Registration,
 * authorization and the token exchange against this server, with local
 * Supabase Auth as the login, and then calls a tool through the SDK's
 * transport with the tokens it stored. Only the consent click is a
 * browser step; everything else is the SDK talking to the endpoints.
 */
class MemoryProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  private client: OAuthClientInformationFull | undefined;
  private saved: OAuthTokens | undefined;
  private verifier: string | undefined;

  get redirectUrl() {
    return CALLBACK_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'MCP SDK test client',
      redirect_uris: [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'studio:read studio:write',
    };
  }

  clientInformation() {
    return this.client;
  }

  saveClientInformation(info: OAuthClientInformationFull) {
    this.client = info;
  }

  tokens() {
    return this.saved;
  }

  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }

  codeVerifier() {
    if (!this.verifier) throw new Error('no verifier saved');

    return this.verifier;
  }
}

test.describe('MCP OAuth: the SDK client', () => {
  test('discovers, registers, authorizes and exchanges against this server, then calls whoami through the SDK transport', async ({
    page,
  }) => {
    const user = await seedTeamAccount({ emailPrefix: 'sdk' });
    const provider = new MemoryProvider();

    // 1. Discovery and registration happen inside auth(); it stops at the
    //    redirect, which it hands to the provider.
    const first = await auth(provider, { serverUrl: MCP_URL });
    expect(first).toBe('REDIRECT');
    expect(provider.clientInformation()?.client_id).toMatch(/^sbk_client_/);
    expect(provider.authorizationUrl?.origin).toBe(new URL(MCP_URL).origin);
    expect(provider.authorizationUrl?.pathname).toBe('/oauth/authorize');
    expect(
      provider.authorizationUrl?.searchParams.get('code_challenge_method'),
    ).toBe('S256');
    expect(provider.authorizationUrl?.searchParams.get('resource')).toBe(
      MCP_URL,
    );

    // 2. The user signs in with local Supabase Auth and approves.
    await signInAs(page, user);
    await page.goto(provider.authorizationUrl!.toString());
    await expect(byTest(page, 'oauth-consent-client')).toContainText(
      'MCP SDK test client',
    );
    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);

    const code = new URL(page.url()).searchParams.get('code');
    expect(code).toBeTruthy();

    // 3. The SDK exchanges the code with its saved verifier.
    const second = await auth(provider, {
      serverUrl: MCP_URL,
      authorizationCode: code!,
    });
    expect(second).toBe('AUTHORIZED');

    const tokens = provider.tokens();
    expect(tokens?.access_token).toMatch(/^sbk_at_/);
    expect(tokens?.refresh_token).toMatch(/^sbk_rt_/);
    expect(tokens?.scope).toBe('studio:read studio:write');

    // 4. The SDK's transport carries the token; the tool answers as the user.
    const client = new Client({ name: 'storybook-e2e', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      authProvider: provider,
    });

    await client.connect(transport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('whoami');

      const whoami = await client.callTool({ name: 'whoami', arguments: {} });
      expect(whoami.isError).toBeFalsy();
      expect(whoami.structuredContent).toMatchObject({
        user: { id: user.userId },
        team: { slug: user.slug },
        connection: {
          clientName: 'MCP SDK test client',
          scopes: ['studio:read', 'studio:write'],
        },
      });
    } finally {
      await client.close();
    }
  });
});
