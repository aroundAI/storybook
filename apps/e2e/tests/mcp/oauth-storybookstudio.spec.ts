import {
  type OAuthClientProvider,
  auth,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { type Page, expect, test } from '@playwright/test';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  insertRow,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import {
  MCP_URL,
  callWhoami,
  exchangeCode,
  refreshTokens,
  registerClient,
} from './oauth-client';

/**
 * FILM-2005: StorybookStudio signs in as the pre-registered `storybookstudio`
 * client, the way FILM-2011's desktop app will: the MCP SDK's own OAuth
 * client, no registration, PKCE S256, a loopback listener on a port it
 * picked, and the device's name sent as `client_name` on the code exchange.
 * The consent needs the team to have StorybookStudio on.
 *
 * Screenshots: CAPTURE_EVIDENCE=1 EVIDENCE_DIR=<dir>.
 */
const CLIENT_ID = 'storybookstudio';
const DEVICE = 'Shaurya’s MacBook (e2e)';
const SCOPE = 'studio:read studio:write studio:render';

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

/** After the page's entrance animations finish, so the capture is legible. */
async function capture(page: Page, name: string) {
  if (!EVIDENCE) return;

  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
}

/** What the desktop app opens for one sign-in: 127.0.0.1, a free port. */
async function loopbackListener() {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<p>Signed in. You can close this tab.</p>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

class StudioProvider implements OAuthClientProvider {
  authorizationUrl: URL | undefined;
  private saved: OAuthTokens | undefined;
  private verifier: string | undefined;

  constructor(private readonly redirect: string) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'StorybookStudio',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    };
  }

  /** Pre-registered: the SDK skips Dynamic Client Registration. */
  clientInformation(): OAuthClientInformation {
    return { client_id: CLIENT_ID };
  }

  /** A public client: its id, and the device's name (FILM-2005). */
  addClientAuthentication(_headers: Headers, params: URLSearchParams) {
    params.set('client_id', CLIENT_ID);

    if (params.get('grant_type') === 'authorization_code') {
      params.set('client_name', DEVICE);
    }
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

test.describe('StorybookStudio signs in as the storybookstudio client (FILM-2005)', () => {
  test('consent needs the team to have it on; the code reaches the loopback port; whoami names the device; revoking logs it out', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-oauth' });
    const loopback = await loopbackListener();
    const provider = new StudioProvider(loopback.redirectUri);

    try {
      // 1. The SDK goes straight to the redirect: no registration
      expect(await auth(provider, { serverUrl: MCP_URL })).toBe('REDIRECT');

      const authorizeUrl = provider.authorizationUrl!;
      expect(authorizeUrl.pathname).toBe('/oauth/authorize');
      expect(authorizeUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
        loopback.redirectUri,
      );
      expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe(
        'S256',
      );

      // 2. The team has StorybookStudio off: a clear page, not a consent
      await signInAs(page, team);
      await page.goto(authorizeUrl.toString());
      await expect(byTest(page, 'oauth-consent-desktop-off')).toBeVisible();
      await expect(byTest(page, 'oauth-consent-approve')).toHaveCount(0);
      await expect(
        byTest(page, `oauth-consent-desktop-off-${team.slug}`),
      ).toHaveAttribute('href', `/home/${team.slug}/settings/ai`);
      await capture(page, '10-consent-studio-off');

      // 3. On: the consent names StorybookStudio, with its icon, the team
      //    and the three scopes
      await insertRow(
        'account_ai_settings',
        { account_id: team.accountId, desktop_integration_enabled: true },
        serviceRoleAuth(),
      );
      await page.reload();

      await expect(byTest(page, 'oauth-consent-client')).toHaveText(
        'StorybookStudio wants to connect to StoryBook',
      );
      await expect(byTest(page, 'oauth-consent-client-icon')).toBeVisible();
      await expect(byTest(page, 'oauth-consent')).toContainText(
        loopback.redirectUri,
      );
      await expect(
        byTest(page, `oauth-consent-team-${team.slug}`),
      ).toBeChecked();
      for (const scope of ['read', 'write', 'render']) {
        await expect(
          byTest(page, `oauth-consent-scope-${scope}`),
        ).toBeChecked();
      }
      await capture(page, '11-consent-storybookstudio');

      // 4. Turned off between showing the consent and approving it: the
      //    approval is refused, and nothing is sent to the app
      await updateRows(
        'account_ai_settings',
        `account_id=eq.${team.accountId}`,
        {
          desktop_integration_enabled: false,
        },
      );
      await byTest(page, 'oauth-consent-approve').click();
      await expect(
        page.getByText('StorybookStudio is turned off for that team.', {
          exact: false,
        }),
      ).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/oauth/authorize');

      // 5. On again; the second approval goes through to the loopback port
      await updateRows(
        'account_ai_settings',
        `account_id=eq.${team.accountId}`,
        {
          desktop_integration_enabled: true,
        },
      );
      await byTest(page, 'oauth-consent-approve').click();
      await page.waitForURL(
        (url) =>
          url.host === `127.0.0.1:${loopback.port}` &&
          url.pathname === '/callback',
      );

      const callback = new URL(page.url());
      const code = callback.searchParams.get('code');
      expect(code).toBeTruthy();
      expect(callback.searchParams.get('iss')).toBe(new URL(MCP_URL).origin);

      // 6. The SDK exchanges it, naming the device
      expect(
        await auth(provider, { serverUrl: MCP_URL, authorizationCode: code! }),
      ).toBe('AUTHORIZED');

      const tokens = provider.tokens()!;
      expect(tokens.access_token).toMatch(/^sbk_at_/);
      expect(tokens.refresh_token).toMatch(/^sbk_rt_/);
      expect(tokens.scope).toBe(SCOPE);

      // 7. The code was single use (FILM-1907's guard)
      const reused = await exchangeCode({
        code: code!,
        clientId: CLIENT_ID,
        verifier: provider.codeVerifier(),
        redirectUri: loopback.redirectUri,
      });
      expect(reused.status).toBe(400);
      expect(reused.body.error).toBe('invalid_grant');

      // 8. whoami, through the SDK transport, as the user, named for the device
      const client = new Client({
        name: 'storybookstudio-e2e',
        version: '1.0.0',
      });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), {
          authProvider: provider,
        }),
      );

      try {
        const whoami = await client.callTool({ name: 'whoami', arguments: {} });
        expect(whoami.isError).toBeFalsy();
        expect(whoami.structuredContent).toMatchObject({
          user: { id: team.userId },
          team: { slug: team.slug },
          connection: {
            clientName: DEVICE,
            scopes: ['studio:read', 'studio:write', 'studio:render'],
          },
        });
      } finally {
        await client.close();
      }

      // 9. Connected apps lists the device; revoking it logs it out
      await page.goto(`/home/${team.slug}/settings/connected-apps`);
      const row = byTest(page, 'mcp-connection-row').filter({
        hasText: DEVICE,
      });
      await expect(row).toHaveCount(1);
      await expect(byTest(row, 'mcp-connection-name')).toHaveText(DEVICE);
      await expect(byTest(row, 'mcp-connection-desktop-app')).toHaveText(
        'StorybookStudio desktop app',
      );
      await capture(page, '12-connected-apps-studio-device');

      await byTest(row, 'mcp-connection-revoke').click();
      await byTest(page, 'mcp-connection-revoke-confirm').click();
      await expect(byTest(row, 'mcp-connection-status')).toHaveText('Revoked');
      await capture(page, '13-connected-apps-studio-revoked');

      const after = await callWhoami(tokens.access_token);
      expect(after.status).toBe(401);

      const refreshed = await refreshTokens({
        refreshToken: tokens.refresh_token!,
        clientId: CLIENT_ID,
      });
      expect(refreshed.status).toBe(400);
      expect(refreshed.body.error).toBe('invalid_grant');
    } finally {
      await loopback.close();
    }
  });

  test('the loopback rule is the Studio’s alone: another client is refused on our page', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-loopback' });
    const registered = await registerClient({
      clientName: 'Loopback impostor',
      redirectUris: ['http://127.0.0.1:9/callback'],
    });
    expect(registered.status).toBe(201);

    await signInAs(page, team);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: registered.body.client_id!,
      redirect_uri: 'http://127.0.0.1:53682/callback',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      scope: SCOPE,
      state: 's',
    });
    await page.goto(`/oauth/authorize?${params.toString()}`);
    await expect(byTest(page, 'oauth-authorize-error')).toContainText(
      'The redirect URI is not one this client registered.',
    );

    // and the Studio itself on a path it did not register
    params.set('client_id', CLIENT_ID);
    params.set('redirect_uri', 'http://127.0.0.1:53682/evil');
    await page.goto(`/oauth/authorize?${params.toString()}`);
    await expect(byTest(page, 'oauth-authorize-error')).toContainText(
      'The redirect URI is not one this client registered.',
    );
  });
});
