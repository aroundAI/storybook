import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';

/**
 * FILM-1904: a personal access token is created in settings, shown once,
 * listed, and revoked; and the token actually works against /api/mcp until
 * it is revoked. The endpoint is driven with plain fetch so a revocation's
 * effect ("the next call is refused") is measured, not inferred from the
 * badge.
 */

const MCP_URL = `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'}/api/mcp`;

async function callWhoami(token: string | null) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    }),
  });

  return {
    status: response.status,
    wwwAuthenticate: response.headers.get('www-authenticate'),
    body: (await response.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
      };
      error?: { code: string };
    },
  };
}

test.describe('Connected apps: personal access tokens', () => {
  test('a token is shown once, works against /api/mcp, and is refused after revocation', async ({
    page,
  }) => {
    const settings = new ConnectedAppsPageObject(page);
    const account = await settings.setup();

    await expect(byTest(page, 'mcp-connections-empty')).toBeVisible();

    // A blank name is refused on the page, not saved.
    await settings.submit().click();
    await expect(byTest(page, 'pat-name-error')).toContainText(
      'Give the token a name',
    );
    await expect(settings.rows()).toHaveCount(0);

    const token = await settings.create('Claude Desktop', ['read', 'write']);

    // Shown once: the list carries the name and scopes, never the token.
    await expect(settings.row('Claude Desktop')).toHaveCount(1);
    await expect(
      byTest(settings.row('Claude Desktop'), 'mcp-connection-scopes'),
    ).toHaveText(/studio:read.*studio:write/);
    await expect(
      byTest(settings.row('Claude Desktop'), 'mcp-connection-status'),
    ).toHaveText('Active');
    const pageText = await page.locator('main').innerText();
    expect(pageText.split(token).length - 1).toBe(1);

    await settings.dismissReveal().click();
    await expect(settings.reveal()).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toContain(token);

    // The form is back to its defaults after the save: this is where a
    // DOM/form-state disagreement shows (CLAUDE.md, "assert the second submission").
    await expect(settings.nameInput()).toHaveValue('');
    await expect(settings.scope('read')).toHaveAttribute(
      'data-state',
      'checked',
    );
    await expect(settings.scope('write')).toHaveAttribute(
      'data-state',
      'unchecked',
    );

    // The token works: whoami answers as this user, in this team, external mode.
    const live = await callWhoami(token);
    expect(live.status).toBe(200);
    expect(live.body.result?.isError).toBeFalsy();
    expect(live.body.result?.structuredContent).toMatchObject({
      user: { id: account.userId },
      team: { slug: account.slug },
      connection: {
        clientName: 'Claude Desktop',
        scopes: ['studio:read', 'studio:write'],
      },
      mode: { generation: 'external', canWrite: true, canRender: false },
    });

    // No token: 401 with the protected-resource pointer.
    const anonymous = await callWhoami(null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.wwwAuthenticate).toMatch(
      /^Bearer resource_metadata="https?:\/\/.+\/\.well-known\/oauth-protected-resource"$/,
    );
    expect(anonymous.body.error?.code).toBe('UNAUTHORIZED');

    // A second token, so the second submission is exercised too.
    const second = await settings.create('CI script', ['read']);
    expect(second).not.toBe(token);
    await settings.dismissReveal().click();
    await expect(settings.rows()).toHaveCount(2);

    // Revoke the first: its next call is refused, the second still works.
    await settings.revoke('Claude Desktop');
    await expect(
      byTest(settings.row('Claude Desktop'), 'mcp-connection-revoke'),
    ).toHaveCount(0);

    const revoked = await callWhoami(token);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error?.code).toBe('UNAUTHORIZED');

    const stillLive = await callWhoami(second);
    expect(stillLive.status).toBe(200);
    expect(stillLive.body.result?.structuredContent).toMatchObject({
      connection: { clientName: 'CI script' },
    });

    // The state survives a reload: the row stays revoked, the other active.
    await page.reload();
    await byTest(page, 'connected-apps-settings').waitFor();
    await expect(
      byTest(settings.row('Claude Desktop'), 'mcp-connection-status'),
    ).toHaveText('Revoked');
    await expect(
      byTest(settings.row('CI script'), 'mcp-connection-status'),
    ).toHaveText('Active');
  });
});
