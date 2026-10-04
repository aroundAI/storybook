import { expect, test } from '@playwright/test';

import { deleteRows, seedTeamAccount, uniqueStamp } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';
import {
  BASE_URL,
  MCP_URL,
  authorizeUrl,
  callWhoami,
  callbackParams,
  exchangeCode,
  pkce,
} from './oauth-client';

/**
 * FILM-1911: Claude and ChatGPT both connect by their published client
 * metadata documents when the authorization server advertises them, as
 * ours does. The server fetches each live document from its real URL, so
 * a change on either side that breaks sign-in shows up here. The browser's
 * last hop, to the client's callback, is answered locally and read.
 */
const PUBLISHED_CLIENTS = [
  {
    name: 'Claude',
    clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  },
  {
    name: 'ChatGPT',
    clientId: 'https://chatgpt.com/oauth/client.json',
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  },
];

for (const client of PUBLISHED_CLIENTS) {
  test(`${client.name}'s published client id signs in, gets iss on the callback, and calls whoami`, async ({
    page,
  }) => {
    const team = await seedTeamAccount({
      emailPrefix: 'published',
      name: `Published ${client.name} ${uniqueStamp().slice(0, 8)}`,
    });
    const { verifier, challenge } = pkce();
    const state = `state-${uniqueStamp().slice(0, 8)}`;

    // A client document is cached after its first fetch; drop the copy an
    // earlier run left so this run fetches the live one
    const byClient = `client_id=eq.${encodeURIComponent(client.clientId)}`;
    await deleteRows('mcp_connections', byClient);
    await deleteRows('mcp_oauth_clients', byClient);

    await page.route(`${client.redirectUri}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
    );

    await signInAs(page, team);
    await page.goto(
      authorizeUrl({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        challenge,
        state,
        scope: null,
      }),
    );

    await expect(byTest(page, 'oauth-consent-client')).toHaveText(
      `${client.name} wants to connect to StoryBook`,
    );

    if (process.env.CAPTURE_EVIDENCE) {
      await expect(byTest(page, 'oauth-consent-approve')).toBeEnabled();
      await page.screenshot({
        path: `${process.env.EVIDENCE_DIR ?? 'evidence'}/consent-${client.name.toLowerCase()}.png`,
        animations: 'disabled',
      });
    }

    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.href.startsWith(client.redirectUri));

    const callbackUrl = new URL(page.url());
    const callback = callbackParams(callbackUrl);

    expect(callbackUrl.origin + callbackUrl.pathname).toBe(client.redirectUri);
    expect(callback.error).toBeNull();
    expect(callback.state).toBe(state);
    expect(callbackUrl.searchParams.get('iss')).toBe(BASE_URL);

    const tokens = await exchangeCode({
      code: callback.code!,
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      verifier,
    });
    expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
    expect(tokens.body.refresh_token).toMatch(/^sbk_rt_/);

    const whoami = await callWhoami(tokens.body.access_token!);
    expect(whoami.status).toBe(200);
    expect(whoami.body.result?.structuredContent).toMatchObject({
      user: { id: team.userId },
      team: { slug: team.slug },
      connection: {
        clientName: client.name,
        scopes: ['studio:read', 'studio:write'],
      },
    });
  });
}

test('Connected apps shows the one connector URL with the steps for Claude and for ChatGPT', async ({
  page,
}) => {
  await new ConnectedAppsPageObject(page).setup();

  const card = byTest(page, 'add-to-claude-card');

  await expect(card).toContainText('Add StoryBook to Claude or ChatGPT');
  await expect(byTest(card, 'mcp-connector-url')).toHaveText(MCP_URL);
  await expect(byTest(card, 'add-to-claude-steps')).toContainText(
    'Customize → Connectors',
  );
  await expect(byTest(card, 'add-to-chatgpt-steps')).toContainText(
    'Developer mode',
  );

  if (process.env.CAPTURE_EVIDENCE) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: `${process.env.EVIDENCE_DIR ?? 'evidence'}/add-to-claude-or-chatgpt-card.png`,
    });
  }
});
