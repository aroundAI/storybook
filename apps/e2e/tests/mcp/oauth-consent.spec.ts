import { expect, test } from '@playwright/test';

import { AuthPageObject } from '../authentication/auth.po';
import { seedTeamAccount, seedTeamForUser, uniqueStamp } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';
import {
  BASE_URL,
  CALLBACK_PATH,
  CALLBACK_URL,
  MCP_URL,
  authorizeUrl,
  callWhoami,
  callbackParams,
  discovery,
  exchangeCode,
  pkce,
  refreshTokens,
  registerClient,
  revokeToken,
} from './oauth-client';

/**
 * FILM-1907: StoryBook as the OAuth 2.1 authorization server for the MCP
 * connector. A registered client sends a signed-out user to
 * /oauth/authorize; they sign in, come back to the consent page with the
 * request intact, pick one of their two teams and approve; the code is
 * exchanged from the test for tokens that work against /api/mcp inside the
 * chosen team; Connected apps lists and revokes the grant; the refresh
 * token rotates and its reuse revokes the connection. The redirect-URI and
 * client checks never redirect.
 */

async function seedUserWithTwoTeams() {
  const stamp = uniqueStamp().slice(0, 8);
  const first = await seedTeamAccount({
    emailPrefix: 'oauth',
    name: `OAuth First ${stamp}`,
  });
  const second = await seedTeamForUser(first, `OAuth Second ${stamp}`);

  return { user: first, first, second };
}

async function registeredClient(name = 'Claude (test)') {
  const registered = await registerClient({ clientName: name });

  expect(registered.status, JSON.stringify(registered.body)).toBe(201);

  return registered.body.client_id!;
}

test.describe('MCP OAuth: discovery', () => {
  test('the two well-known documents name the MCP resource, our server, S256 and the scopes', async () => {
    const resource = await discovery('/.well-known/oauth-protected-resource');

    expect(resource.status).toBe(200);
    expect(resource.cors).toBe('*');
    expect(resource.body).toMatchObject({
      resource: MCP_URL,
      authorization_servers: [BASE_URL],
      scopes_supported: ['studio:read', 'studio:write', 'studio:render'],
    });

    // The path-aware form the MCP SDK tries first (RFC 9728 §3.1).
    const pathAware = await discovery(
      '/.well-known/oauth-protected-resource/api/mcp',
    );
    expect(pathAware.status).toBe(200);
    expect(pathAware.body.resource).toBe(MCP_URL);

    const server = await discovery('/.well-known/oauth-authorization-server');

    expect(server.status).toBe(200);
    expect(server.body).toMatchObject({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/oauth/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      registration_endpoint: `${BASE_URL}/oauth/register`,
      revocation_endpoint: `${BASE_URL}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
    });

    // The endpoint's 401 points at the protected-resource document.
    const anonymous = await callWhoami(null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.wwwAuthenticate).toBe(
      `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
    );
  });

  test('registration refuses a redirect URI off the loopback over http, and a client secret method', async () => {
    const plainHttp = await registerClient({
      clientName: 'Bad',
      redirectUris: ['http://example.com/cb'],
    });
    expect(plainHttp.status).toBe(400);
    expect(plainHttp.body.error).toBe('invalid_redirect_uri');

    const response = await fetch(`${BASE_URL}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [CALLBACK_URL],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      'invalid_client_metadata',
    );
  });
});

test.describe('MCP OAuth: consent', () => {
  test('a signed-out user signs in, comes back to the consent page, picks a team and approves; the code becomes tokens that work in that team; Connected apps lists and revokes the grant', async ({
    page,
  }) => {
    const { user, first, second } = await seedUserWithTwoTeams();
    const clientId = await registeredClient();
    const { verifier, challenge } = pkce();
    const state = `state-${uniqueStamp().slice(0, 8)}`;

    // Signed out: the request is parked in next= and the sign-in page opens.
    await page.goto(authorizeUrl({ clientId, challenge, state }));
    await page.waitForURL(/\/auth\/sign-in\?/);

    const next = new URL(page.url()).searchParams.get('next') ?? '';
    expect(next).toContain('/oauth/authorize?');
    expect(next).toContain(`client_id=${encodeURIComponent(clientId)}`);

    await new AuthPageObject(page).signIn(user);

    // Back on the consent page, with the request intact.
    await page.waitForURL(/\/oauth\/authorize\?/);
    expect(new URL(page.url()).searchParams.get('state')).toBe(state);

    await expect(byTest(page, 'oauth-consent-client')).toHaveText(
      'Claude (test) wants to connect to StoryBook',
    );
    await expect(
      byTest(page, `oauth-consent-team-${first.slug}`),
    ).toBeVisible();
    await expect(
      byTest(page, `oauth-consent-team-${second.slug}`),
    ).toBeVisible();

    for (const scope of ['read', 'write', 'render']) {
      await expect(
        byTest(page, `oauth-consent-scope-${scope}`),
      ).toHaveAttribute('data-state', 'checked');
    }

    // Choose the second team and withhold renders.
    await byTest(page, `oauth-consent-team-${second.slug}`).click();
    await byTest(page, 'oauth-consent-scope-render').click();
    await expect(byTest(page, 'oauth-consent-scope-render')).toHaveAttribute(
      'data-state',
      'unchecked',
    );

    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);

    const callback = callbackParams(new URL(page.url()));
    expect(callback.error).toBeNull();
    expect(callback.state).toBe(state);
    expect(callback.code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The code becomes a 1-hour access token and a refresh token, both ours.
    const tokens = await exchangeCode({
      code: callback.code!,
      clientId,
      verifier,
    });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    expect(tokens.body.token_type).toBe('Bearer');
    expect(tokens.body.expires_in).toBe(3600);
    expect(tokens.body.scope).toBe('studio:read studio:write');
    expect(tokens.body.access_token).toMatch(/^sbk_at_[A-Za-z0-9_-]{43}$/);
    expect(tokens.body.refresh_token).toMatch(/^sbk_rt_[A-Za-z0-9_-]{43}$/);

    // Single use: the same code again is refused and issues nothing.
    const again = await exchangeCode({
      code: callback.code!,
      clientId,
      verifier,
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_grant');

    // The access token acts as this user in the team chosen at consent.
    const live = await callWhoami(tokens.body.access_token!);
    expect(live.status).toBe(200);
    expect(live.body.result?.isError).toBeFalsy();
    expect(live.body.result?.structuredContent).toMatchObject({
      user: { id: user.userId },
      team: { slug: second.slug },
      connection: {
        clientName: 'Claude (test)',
        scopes: ['studio:read', 'studio:write'],
      },
      mode: { generation: 'external', canWrite: true, canRender: false },
    });

    // A refresh token is not a bearer credential.
    const refreshAsBearer = await callWhoami(tokens.body.refresh_token!);
    expect(refreshAsBearer.status).toBe(401);

    // Connected apps: the grant is listed on the team it was bound to, and
    // on no other.
    const settings = new ConnectedAppsPageObject(page);

    await settings.goTo(first.slug);
    await expect(byTest(page, 'mcp-connections-empty')).toBeVisible();

    await settings.goTo(second.slug);
    const row = settings.row('Claude (test)');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('OAuth app');
    await expect(byTest(row, 'mcp-connection-scopes')).toHaveText(
      /studio:read.*studio:write/,
    );
    await expect(byTest(row, 'mcp-connection-scopes')).not.toContainText(
      'studio:render',
    );
    await expect(byTest(row, 'mcp-connection-status')).toHaveText('Active');
    await expect(byTest(page, 'mcp-connector-url')).toHaveText(MCP_URL);

    // Revoke from settings: every token of the connection is refused.
    await settings.revoke('Claude (test)');

    const afterRevoke = await callWhoami(tokens.body.access_token!);
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.body.error?.details).toMatchObject({
      reason: 'revoked',
    });

    const refreshAfterRevoke = await refreshTokens({
      refreshToken: tokens.body.refresh_token!,
      clientId,
    });
    expect(refreshAfterRevoke.status).toBe(400);
    expect(refreshAfterRevoke.body.error).toBe('invalid_grant');

    // The second state survives a reload.
    await page.reload();
    await byTest(page, 'connected-apps-settings').waitFor();
    await expect(
      byTest(settings.row('Claude (test)'), 'mcp-connection-status'),
    ).toHaveText('Revoked');
  });

  test('the refresh token rotates, and reuse of the rotated one revokes the whole connection', async ({
    page,
  }) => {
    const { user, first } = await seedUserWithTwoTeams();
    const clientId = await registeredClient('Rotating client');
    const { verifier, challenge } = pkce();

    await signInAs(page, user);
    await page.goto(
      authorizeUrl({ clientId, challenge, scope: 'studio:read' }),
    );
    await byTest(page, `oauth-consent-team-${first.slug}`).click();
    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);

    const { code } = callbackParams(new URL(page.url()));
    const initial = await exchangeCode({ code: code!, clientId, verifier });
    expect(initial.status).toBe(200);

    const rotated = await refreshTokens({
      refreshToken: initial.body.refresh_token!,
      clientId,
    });
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    expect(rotated.body.access_token).not.toBe(initial.body.access_token);
    expect(rotated.body.refresh_token).not.toBe(initial.body.refresh_token);
    expect(rotated.body.scope).toBe('studio:read');

    expect((await callWhoami(rotated.body.access_token!)).status).toBe(200);

    // The old refresh token again: two parties hold it, so the grant ends.
    const reuse = await refreshTokens({
      refreshToken: initial.body.refresh_token!,
      clientId,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');

    const afterReuse = await callWhoami(rotated.body.access_token!);
    expect(afterReuse.status).toBe(401);
    expect(afterReuse.body.error?.details).toMatchObject({ reason: 'revoked' });

    // Another client's id cannot redeem this client's code.
    const other = await registeredClient('Other client');
    const second = pkce();
    await page.goto(
      authorizeUrl({
        clientId,
        challenge: second.challenge,
        scope: 'studio:read',
      }),
    );
    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    const stolen = callbackParams(new URL(page.url()));

    const wrongClient = await exchangeCode({
      code: stolen.code!,
      clientId: other,
      verifier: second.verifier,
    });
    expect(wrongClient.status).toBe(400);
    expect(wrongClient.body.error).toBe('invalid_grant');

    // /oauth/revoke of an access token is honoured.
    const third = pkce();
    await page.goto(
      authorizeUrl({
        clientId,
        challenge: third.challenge,
        scope: 'studio:read',
      }),
    );
    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    const fresh = await exchangeCode({
      code: callbackParams(new URL(page.url())).code!,
      clientId,
      verifier: third.verifier,
    });
    expect(fresh.status).toBe(200);
    expect((await revokeToken(fresh.body.access_token!)).status).toBe(200);
    expect((await callWhoami(fresh.body.access_token!)).status).toBe(401);
  });

  test('an unregistered redirect URI or unknown client is an error on our page, never a redirect; a wrong PKCE method goes back to the client as an error; deny returns access_denied', async ({
    page,
  }) => {
    const { user } = await seedUserWithTwoTeams();
    const clientId = await registeredClient('Checked client');
    const { challenge } = pkce();

    await signInAs(page, user);

    // Open redirect attempt: shown here, URL unchanged.
    await page.goto(
      authorizeUrl({
        clientId,
        challenge,
        redirectUri: 'https://evil.example/callback',
      }),
    );
    await expect(byTest(page, 'oauth-authorize-error')).toBeVisible();
    await expect(byTest(page, 'oauth-authorize-error')).toContainText(
      'invalid_redirect_uri',
    );
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');

    await page.goto(authorizeUrl({ clientId: 'sbk_client_nobody', challenge }));
    await expect(byTest(page, 'oauth-authorize-error')).toContainText(
      'invalid_client',
    );
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');

    // A registered URI but no S256: the client is told.
    await page.goto(authorizeUrl({ clientId, challenge, method: 'plain' }));
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    expect(callbackParams(new URL(page.url())).error).toBe('invalid_request');

    // A resource other than this MCP server.
    await page.goto(
      authorizeUrl({
        clientId,
        challenge,
        resource: 'https://other.example/api/mcp',
      }),
    );
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    expect(callbackParams(new URL(page.url())).error).toBe('invalid_target');

    // Deny.
    const state = 'deny-state';
    await page.goto(authorizeUrl({ clientId, challenge, state }));
    await byTest(page, 'oauth-consent-deny').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    expect(callbackParams(new URL(page.url()))).toMatchObject({
      error: 'access_denied',
      state,
      code: null,
    });

    // Approving with every scope unticked is refused on the page.
    await page.goto(
      authorizeUrl({ clientId, challenge, scope: 'studio:read' }),
    );
    await byTest(page, 'oauth-consent-scope-read').click();
    await byTest(page, 'oauth-consent-approve').click();
    await expect(byTest(page, 'oauth-consent-scopes-error')).toContainText(
      'Choose at least one scope',
    );
    expect(new URL(page.url()).pathname).toBe('/oauth/authorize');
  });
});
