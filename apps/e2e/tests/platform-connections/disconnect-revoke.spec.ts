import { Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { type Server, createServer } from 'node:http';

import { encryptLikeTheApp } from '../utils/crypto';
import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-25, KB-45, KB-86, KB-87 — connecting and disconnecting, against one
 * local listener standing in for Google, X and LinkedIn (FILM-1801's
 * `VENDOR_URL_*`), through the production build.
 *
 * - KB-86: the Platforms page had no X or LinkedIn card, so neither could be
 *   connected or disconnected there.
 * - KB-87: a successful X (and TikTok, LinkedIn) connect redirected to a
 *   relative URL, which Next refuses, so it landed on the failure page.
 * - KB-25: disconnecting X asked X for nothing; LinkedIn offers apps no revoke.
 * - KB-45: whatever the platform answered, the creator saw the same toast.
 *
 * The server needs, in its environment (`NODE_ENV=test next start`), with
 * `NEXT_PUBLIC_APP_URL` also set at build time to the server's own origin:
 *
 *   ENCRYPTION_KEY=<same as this run's>  VENDOR_SANDBOX=1
 *   VENDOR_URL_GOOGLE_TOKEN  VENDOR_URL_X_API  VENDOR_URL_X_OAUTH
 *   VENDOR_URL_LINKEDIN_OAUTH  VENDOR_URL_LINKEDIN_API
 *     = http://127.0.0.1:$KB25_SANDBOX_PORT
 *   TWITTER_CLIENT_ID=kb25-x-client  TWITTER_CLIENT_SECRET=kb25-x-secret
 *   LINKEDIN_CLIENT_ID=kb25-li-client  LINKEDIN_CLIENT_SECRET=kb25-li-secret
 *
 * and this run needs `KB25_SANDBOX_PORT` and `ENCRYPTION_KEY`. CI's E2E job
 * has none of these, so this file skips there. The live checks against X and
 * LinkedIn wait on credentials: FILM-1725 Check I.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const SANDBOX_PORT = process.env.KB25_SANDBOX_PORT;
const X_BASIC = `Basic ${Buffer.from('kb25-x-client:kb25-x-secret').toString('base64')}`;

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  authorization?: string;
}

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-25-${name}.png`, fullPage: true });
}

/**
 * One listener for every vendor: Google's `/revoke`; X's authorize page,
 * token, user and revoke endpoints; LinkedIn's authorize page. Each X
 * authorization issues fresh tokens, so a test can tell which were revoked.
 */
async function startStandIn(port: number) {
  const seen: Seen[] = [];
  const stand = { revokeStatus: 200, xUser: { id: '', username: '' } };
  const issued: { access: string; refresh: string }[] = [];

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stand-in');
    let body = '';

    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        path: url.pathname,
        query: url.searchParams,
        body,
        authorization: request.headers.authorization,
      });

      const json = (status: number, value: unknown) => {
        response.statusCode = status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(value));
      };

      switch (url.pathname) {
        // X's consent screen, already accepted: straight back with a code.
        case '/i/oauth2/authorize': {
          const back = new URL(url.searchParams.get('redirect_uri') ?? '');
          back.searchParams.set('code', `kb25-code-${randomUUID()}`);
          back.searchParams.set('state', url.searchParams.get('state') ?? '');
          response.statusCode = 302;
          response.setHeader('location', back.toString());
          response.end();
          return;
        }
        case '/2/oauth2/token': {
          const tokens = {
            access: `x-access-${randomUUID()}`,
            refresh: `x-refresh-${randomUUID()}`,
          };
          issued.push(tokens);
          return json(200, {
            token_type: 'bearer',
            access_token: tokens.access,
            refresh_token: tokens.refresh,
            expires_in: 7200,
            scope:
              'tweet.read tweet.write media.write users.read offline.access',
          });
        }
        case '/2/users/me':
          return json(200, {
            data: { ...stand.xUser, name: 'Acme', profile_image_url: '' },
          });
        case '/2/oauth2/revoke':
        case '/revoke':
          return json(stand.revokeStatus, {});
        // LinkedIn's consent screen: not followed further (the live flow is
        // FILM-1725's); the test asserts the request that reached it.
        case '/oauth/v2/authorization':
          response.setHeader('content-type', 'text/html');
          response.end(
            '<h1 data-test="linkedin-consent">LinkedIn stand-in</h1>',
          );
          return;
        default:
          return json(404, {});
      }
    });
  });

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));

  return {
    seen,
    stand,
    issued,
    requests: (path: string) => seen.filter((entry) => entry.path === path),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function row(page: Page, connectionId: string) {
  return page.locator(
    `[data-test="connection-row"][data-connection-id="${connectionId}"]`,
  );
}

function card(page: Page, platform: string) {
  return byTest(page, `platform-card-${platform}`);
}

async function openDisconnect(
  page: Page,
  rowLocator: ReturnType<Page['locator']>,
) {
  await byTest(rowLocator, 'disconnect-connection').click();

  const dialog = byTest(page, 'disconnect-dialog');

  await expect(dialog).toBeVisible();

  return dialog;
}

const unconfirmed = (page: Page) =>
  byTest(page, 'disconnect-revoke-unconfirmed');

test.describe('Connecting and disconnecting, and what the platform is asked (KB-25, KB-45, KB-86, KB-87)', () => {
  test.skip(
    !SANDBOX_PORT || !process.env.ENCRYPTION_KEY,
    'Needs the local vendor sandbox (KB25_SANDBOX_PORT, ENCRYPTION_KEY)',
  );

  // One stand-in on one port, which the server was started pointing at: the
  // tests share it, so they run in order in one worker. Not `serial` — one
  // failure must not skip the rest.
  test.describe.configure({ mode: 'default' });

  let vendor: Awaited<ReturnType<typeof startStandIn>>;

  test.beforeAll(async () => {
    vendor = await startStandIn(Number(SANDBOX_PORT));
  });

  test.afterAll(async () => {
    await vendor?.close();
  });

  test.beforeEach(() => {
    vendor.seen.length = 0;
    vendor.issued.length = 0;
    vendor.stand.revokeStatus = 200;
  });

  test('X: Connect lands on the platforms page with the new row; Disconnect revokes both tokens at X; a refusal is shown', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb86x' });
    vendor.stand.xUser = {
      id: `x-${randomUUID().slice(0, 8)}`,
      username: 'acme_on_x',
    };

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    const x = card(page, 'twitter');

    await expect(x).toBeVisible();
    await expect(byTest(x, 'platform-limitation-twitter')).toContainText(
      "Publishing to X doesn't work yet",
    );
    await capture(page, '01-x-card');

    // Connect: the real connect route, X's authorize page (stand-in), the
    // real callback — which used to end on the failure page (KB-87).
    await byTest(x, 'connect-platform-twitter').click();
    await page.waitForURL(
      new RegExp(
        `/home/${team.slug}/settings/platforms\\?success=twitter_connected`,
      ),
    );

    const authorize = vendor.requests('/i/oauth2/authorize')[0];

    expect(authorize?.query.get('client_id')).toBe('kb25-x-client');
    expect(authorize?.query.get('code_challenge_method')).toBe('S256');
    expect(authorize?.query.get('scope')).toBe(
      'tweet.read tweet.write media.write users.read offline.access',
    );

    const connected = byTest(x, 'connection-row');

    await expect(connected).toHaveCount(1);
    await expect(connected).toContainText('acme_on_x');
    await capture(page, '02-x-connected');

    // Disconnect: X agrees to both revokes.
    const dialog = await openDisconnect(page, connected);

    await expect(byTest(dialog, 'disconnect-access')).toContainText(
      "We'll also ask X to revoke our access.",
    );
    await capture(page, '03-x-dialog');

    await byTest(dialog, 'confirm-disconnect').click();
    await expect(connected).toHaveAttribute('data-status', 'disconnected');
    await expect(
      page.getByText('Disconnected acme_on_x. Your records are kept.'),
    ).toBeVisible();
    await expect(unconfirmed(page)).toHaveCount(0);

    const [first] = vendor.issued;

    expect(
      vendor.requests('/2/oauth2/revoke').map((entry) => ({
        body: entry.body,
        authorization: entry.authorization,
      })),
    ).toEqual([
      { body: `token=${first?.refresh}`, authorization: X_BASIC },
      { body: `token=${first?.access}`, authorization: X_BASIC },
    ]);
    await capture(page, '04-x-revoked');

    // Second submission: reconnect the same X account — the same row comes
    // back (KB-22) — and this time X refuses the revoke.
    await page.goto(`/home/${team.slug}/settings/platforms`);
    await byTest(x, 'connect-platform-twitter').click();
    await page.waitForURL(/success=twitter_connected/);
    await expect(connected).toHaveCount(1);
    await expect(connected).not.toHaveAttribute('data-status', 'disconnected');

    vendor.stand.revokeStatus = 400;

    await (await openDisconnect(page, connected))
      .locator('[data-test="confirm-disconnect"]')
      .click();
    await expect(connected).toHaveAttribute('data-status', 'disconnected');

    const second = vendor.issued[1];

    expect(
      vendor
        .requests('/2/oauth2/revoke')
        .slice(2)
        .map((entry) => entry.body),
    ).toEqual([`token=${second?.refresh}`, `token=${second?.access}`]);

    await expect(unconfirmed(page)).toContainText(
      "Disconnected acme_on_x. X didn't confirm it removed our access",
    );
    await expect(
      unconfirmed(page).locator(
        '[data-test="disconnect-revoke-settings-link"]',
      ),
    ).toHaveAttribute('href', 'https://x.com/settings/connected_apps');
    await expect(
      page
        .locator('[data-sonner-toast]')
        .filter({ has: unconfirmed(page) })
        .locator('[data-close-button]'),
    ).toBeVisible();
    await capture(page, '05-x-refused-warning');
  });

  test('LinkedIn: Connect reaches LinkedIn’s consent screen; an existing row disconnects, and LinkedIn — which offers no revoke — is not called', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb86li' });
    const suffix = randomUUID().slice(0, 8);
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Acme on LinkedIn',
      {
        platform: 'linkedin',
        platformAccountId: `li-${suffix}`,
        accessTokenEncrypted: await encryptLikeTheApp(`li-access-${suffix}`),
        refreshTokenEncrypted: await encryptLikeTheApp(`li-refresh-${suffix}`),
      },
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    const linkedin = card(page, 'linkedin');

    await expect(
      byTest(linkedin, 'platform-limitation-linkedin'),
    ).toContainText('Personal profiles only');
    await expect(row(page, connectionId)).toContainText('Acme on LinkedIn');
    await capture(page, '06-linkedin-card');

    const dialog = await openDisconnect(page, row(page, connectionId));

    await expect(byTest(dialog, 'disconnect-access')).toContainText(
      "LinkedIn doesn't let apps revoke their own access, so remove our access in LinkedIn's settings too.",
    );
    await capture(page, '07-linkedin-dialog');

    await byTest(dialog, 'confirm-disconnect').click();
    await expect(row(page, connectionId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
    await expect(
      unconfirmed(page).locator(
        '[data-test="disconnect-revoke-settings-link"]',
      ),
    ).toHaveAttribute(
      'href',
      'https://www.linkedin.com/mypreferences/d/data-sharing-for-permitted-services',
    );
    expect(vendor.seen).toEqual([]);
    await capture(page, '08-linkedin-warning');

    // Connect: the real connect route sends the browser to LinkedIn's
    // consent screen with our client and the personal-profile scopes.
    await page.goto(`/home/${team.slug}/settings/platforms`);
    await byTest(linkedin, 'connect-platform-linkedin').click();
    await expect(byTest(page, 'linkedin-consent')).toBeVisible();

    const authorize = vendor.requests('/oauth/v2/authorization')[0];

    expect(authorize?.query.get('client_id')).toBe('kb25-li-client');
    expect(authorize?.query.get('scope')).toBe(
      'openid profile email w_member_social',
    );
    expect(authorize?.query.get('redirect_uri')).toMatch(
      /\/api\/platforms\/callback\/linkedin$/,
    );
  });

  test('YouTube: Google refuses — a warning that stays and links to Google; Google agrees — the green toast (KB-45)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb45' });
    const suffix = randomUUID().slice(0, 8);
    const refused = await seedYouTubeConnection(team.accountId, 'Acme TV', {
      platformAccountId: `UC-kb45-refused-${suffix}`,
      accessTokenEncrypted: await encryptLikeTheApp(`kb45-refused-${suffix}`),
    });
    const agreed = await seedYouTubeConnection(team.accountId, 'Acme Two', {
      platformAccountId: `UC-kb45-agreed-${suffix}`,
      accessTokenEncrypted: await encryptLikeTheApp(`kb45-agreed-${suffix}`),
    });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    vendor.stand.revokeStatus = 400;
    await (await openDisconnect(page, row(page, refused)))
      .locator('[data-test="confirm-disconnect"]')
      .click();
    await expect(row(page, refused)).toHaveAttribute(
      'data-status',
      'disconnected',
    );

    await expect(unconfirmed(page)).toContainText(
      "Disconnected Acme TV. YouTube didn't confirm it removed our access",
    );
    await expect(
      unconfirmed(page).locator(
        '[data-test="disconnect-revoke-settings-link"]',
      ),
    ).toHaveAttribute(
      'href',
      'https://security.google.com/settings/security/permissions',
    );
    await expect(
      page.getByText('Disconnected Acme TV. Your records are kept.'),
    ).toHaveCount(0);

    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ has: unconfirmed(page) });

    await expect(toast.locator('[data-close-button]')).toBeVisible();
    expect(
      vendor.requests('/revoke').map((entry) => entry.query.get('token')),
    ).toEqual([`kb45-refused-${suffix}`]);
    await capture(page, '09-youtube-refused-warning');

    await toast.locator('[data-close-button]').click();
    await expect(unconfirmed(page)).toHaveCount(0);

    // Second submission: Google agrees, and the creator is told only that.
    vendor.stand.revokeStatus = 200;
    await (await openDisconnect(page, row(page, agreed)))
      .locator('[data-test="confirm-disconnect"]')
      .click();
    await expect(row(page, agreed)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
    await expect(
      page.getByText('Disconnected Acme Two. Your records are kept.'),
    ).toBeVisible();
    await expect(unconfirmed(page)).toHaveCount(0);
    expect(
      vendor.requests('/revoke').map((entry) => entry.query.get('token')),
    ).toEqual([`kb45-refused-${suffix}`, `kb45-agreed-${suffix}`]);
    await capture(page, '10-youtube-revoked');
  });
});
