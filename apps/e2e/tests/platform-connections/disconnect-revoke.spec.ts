import { Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { type Server, createServer } from 'node:http';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  SeededTeam,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-25 and KB-45. Disconnecting X used to ask X for nothing: the refresh
 * token stayed valid at X for up to 180 days. LinkedIn offers apps no revoke
 * at all, and the dialog said "not yet" as though it were coming. And
 * whatever a platform answered, the creator saw the same green toast.
 *
 * A local listener stands in for X (FILM-1801's `VENDOR_URL_X_API`), so what
 * is checked is the request the production build sends and what the creator
 * is shown for X's answer. It needs a server started for it:
 *
 *   KB25_X_SANDBOX_PORT=4125 ENCRYPTION_KEY=<the server's>
 *   VENDOR_SANDBOX=1 VENDOR_URL_X_API=http://127.0.0.1:4125
 *   TWITTER_CLIENT_ID=kb25-client TWITTER_CLIENT_SECRET=kb25-secret
 *
 * in the server's environment (`NODE_ENV=test next start`), and the port and
 * key in this run's. CI's E2E job has none of these, so this file skips there.
 * The live revoke at X waits on credentials: FILM-1725 Check I.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const SANDBOX_PORT = process.env.KB25_X_SANDBOX_PORT;
const X_BASIC = `Basic ${Buffer.from('kb25-client:kb25-secret').toString('base64')}`;

interface Seen {
  method: string;
  path: string;
  authorization?: string;
  body: string;
}

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-25-${name}.png` });
}

async function startXStandIn(port: number) {
  const seen: Seen[] = [];
  const stand = { status: 200 };

  const server: Server = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        path: new URL(request.url ?? '/', 'http://stand-in').pathname,
        authorization: request.headers.authorization,
        body,
      });
      response.statusCode = stand.status;
      response.setHeader('content-type', 'application/json');
      response.end(stand.status === 200 ? '{"revoked":true}' : '{}');
    });
  });

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));

  return {
    seen,
    stand,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function seedConnection(
  team: SeededTeam,
  platform: 'twitter' | 'linkedin',
  name: string,
) {
  const id = randomUUID().slice(0, 8);

  return seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `kb25-${platform}-${id}`,
    accessTokenEncrypted: await encryptLikeTheApp(`${platform}-access-${id}`),
    refreshTokenEncrypted: await encryptLikeTheApp(`${platform}-refresh-${id}`),
  }).then((connectionId) => ({ connectionId, id }));
}

function row(page: Page, connectionId: string) {
  return page.locator(
    `[data-test="connection-row"][data-connection-id="${connectionId}"]`,
  );
}

async function openDisconnect(page: Page, connectionId: string) {
  await row(page, connectionId)
    .locator('[data-test="disconnect-connection"]')
    .click();

  const dialog = page.locator('[data-test="disconnect-dialog"]');

  await expect(dialog).toBeVisible();

  return dialog;
}

test.describe('Disconnecting asks the platform to revoke, and says when it did not (KB-25, KB-45)', () => {
  test.skip(
    !SANDBOX_PORT || !process.env.ENCRYPTION_KEY,
    'Needs the local X sandbox (KB25_X_SANDBOX_PORT, ENCRYPTION_KEY)',
  );

  let x: Awaited<ReturnType<typeof startXStandIn>>;

  test.beforeAll(async () => {
    x = await startXStandIn(Number(SANDBOX_PORT));
  });

  test.afterAll(async () => {
    await x?.close();
  });

  test.beforeEach(() => {
    x.seen.length = 0;
    x.stand.status = 200;
  });

  test('X: both tokens are revoked at X; a refusal the second time is shown, not hidden', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb25' });
    const first = await seedConnection(team, 'twitter', 'Acme on X');
    const second = await seedConnection(team, 'twitter', 'Acme Two on X');

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    // First submission: X agrees.
    const dialog = await openDisconnect(page, first.connectionId);

    await expect(
      dialog.locator('[data-test="disconnect-access"]'),
    ).toContainText('to revoke our access.');
    await expect(dialog).not.toContainText('yet');
    await capture(page, '01-x-dialog');

    await dialog.locator('[data-test="confirm-disconnect"]').click();
    await expect(row(page, first.connectionId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
    await expect(
      page.getByText('Disconnected Acme on X. Your records are kept.'),
    ).toBeVisible();
    await expect(
      page.locator('[data-test="disconnect-revoke-unconfirmed"]'),
    ).toHaveCount(0);
    await capture(page, '02-x-revoked-toast');

    expect(x.seen).toEqual([
      {
        method: 'POST',
        path: '/2/oauth2/revoke',
        authorization: X_BASIC,
        body: `token=twitter-refresh-${first.id}`,
      },
      {
        method: 'POST',
        path: '/2/oauth2/revoke',
        authorization: X_BASIC,
        body: `token=twitter-access-${first.id}`,
      },
    ]);

    // Second submission: X refuses. The disconnect still happens, and the
    // creator is told to check at X instead of being shown success.
    x.seen.length = 0;
    x.stand.status = 400;

    await (await openDisconnect(page, second.connectionId))
      .locator('[data-test="confirm-disconnect"]')
      .click();
    await expect(row(page, second.connectionId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );

    const warning = page.locator('[data-test="disconnect-revoke-unconfirmed"]');

    await expect(warning).toContainText(
      "Disconnected Acme Two on X. X (Twitter) didn't confirm it removed our access",
    );
    await expect(
      warning.locator('[data-test="disconnect-revoke-settings-link"]'),
    ).toHaveAttribute('href', 'https://x.com/settings/connected_apps');
    await expect(
      page.getByText('Disconnected Acme Two on X. Your records are kept.'),
    ).toHaveCount(0);
    // It stays until dismissed: the creator has something left to do.
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ has: warning })
        .locator('[data-close-button]'),
    ).toBeVisible();
    expect(x.seen.map((request) => request.body)).toEqual([
      `token=twitter-refresh-${second.id}`,
      `token=twitter-access-${second.id}`,
    ]);
    await capture(page, '03-x-refused-warning');
  });

  test('LinkedIn: the dialog says LinkedIn offers no revoke, nothing is sent, and the creator is pointed at LinkedIn', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb25li' });
    const linkedin = await seedConnection(team, 'linkedin', 'Acme on LinkedIn');

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    const dialog = await openDisconnect(page, linkedin.connectionId);

    await expect(
      dialog.locator('[data-test="disconnect-access"]'),
    ).toContainText(
      "LinkedIn doesn't let apps revoke their own access, so remove our access in LinkedIn's settings too.",
    );
    await capture(page, '04-linkedin-dialog');

    await dialog.locator('[data-test="confirm-disconnect"]').click();
    await expect(row(page, linkedin.connectionId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );

    const warning = page.locator('[data-test="disconnect-revoke-unconfirmed"]');

    await expect(
      warning.locator('[data-test="disconnect-revoke-settings-link"]'),
    ).toHaveAttribute(
      'href',
      'https://www.linkedin.com/mypreferences/d/data-sharing-for-permitted-services',
    );
    expect(x.seen).toEqual([]);
    await capture(page, '05-linkedin-warning');
  });
});
