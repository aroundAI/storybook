import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { type Server, createServer } from 'node:http';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  deleteRows,
  insertRow,
  readRows,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-127: the Refresh button's action force-refreshed any connection id it
 * was sent. The refresh reads and writes the connection with the admin
 * client, so a caller who cannot even see a connection could make the
 * platform refuse its token and have it deactivated.
 *
 * Bob, owner of one team, clicks Refresh on his own YouTube channel, and the
 * request is rewritten on its way out to name Alice's channel in another
 * team: the one change an attacker makes. A local stand-in for Google's
 * token endpoint (FILM-1801's `VENDOR_URL_GOOGLE_TOKEN`) refuses every
 * refresh and records what it was sent.
 *
 * The server needs, in its environment (`NODE_ENV=test next start`):
 *   ENCRYPTION_KEY=<same as this run's>  VENDOR_SANDBOX=1
 *   VENDOR_URL_GOOGLE_TOKEN=http://127.0.0.1:$KB127_SANDBOX_PORT
 * and this run needs `KB127_SANDBOX_PORT` and `ENCRYPTION_KEY`. CI's E2E job
 * has none of these, so this file skips there.
 */

const SANDBOX_PORT = process.env.KB127_SANDBOX_PORT;
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Refreshing a connection (KB-127)', () => {
  test.skip(
    !SANDBOX_PORT || !process.env.ENCRYPTION_KEY,
    'needs KB127_SANDBOX_PORT and ENCRYPTION_KEY, and a server started with them',
  );

  const seen: Array<{ path: string; refreshToken: string | null }> = [];
  let server: Server;

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const url = new URL(request.url ?? '/', 'http://sandbox');
        seen.push({
          path: url.pathname,
          refreshToken: new URLSearchParams(body).get('refresh_token'),
        });
        // Google refusing the refresh token, as it does for a revoked grant.
        response.statusCode = 400;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: 'invalid_grant' }));
      });
    });
    await new Promise<void>((done) =>
      server.listen(Number(SANDBOX_PORT), '127.0.0.1', done),
    );

    // Refresh needs YouTube app credentials to reach Google at all (KB-29).
    await deleteRows('oauth_app_credentials', 'platform=eq.youtube');
    await insertRow(
      'oauth_app_credentials',
      {
        platform: 'youtube',
        client_id: 'kb127-client-id',
        client_secret_encrypted: await encryptLikeTheApp('kb127-client-secret'),
      },
      serviceRoleAuth(),
    );
  });

  test.afterAll(async () => {
    await deleteRows('oauth_app_credentials', 'platform=eq.youtube');
    await new Promise((done) => server.close(done));
  });

  test('another team cannot make the platform refuse, and so deactivate, a connection it cannot see', async ({
    page,
  }) => {
    const stamp = uniqueStamp().slice(0, 8);
    const alice = await seedTeamAccount({ emailPrefix: 'kb127-alice' });
    const bob = await seedTeamAccount({ emailPrefix: 'kb127-bob' });

    const aliceChannel = await seedYouTubeConnection(
      alice.accountId,
      `Alice channel ${stamp}`,
      {
        accessTokenEncrypted: await encryptLikeTheApp('alice-access'),
        refreshTokenEncrypted: await encryptLikeTheApp('alice-refresh'),
      },
    );
    const bobChannel = await seedYouTubeConnection(
      bob.accountId,
      `Bob channel ${stamp}`,
      {
        accessTokenEncrypted: await encryptLikeTheApp('bob-access'),
        refreshTokenEncrypted: await encryptLikeTheApp('bob-refresh'),
      },
    );

    // Bob's Refresh request, rewritten to name Alice's connection.
    await page.route('**/*', async (route) => {
      const request = route.request();
      const body = request.postData();

      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        body?.includes(bobChannel)
      ) {
        return route.continue({
          postData: body.replaceAll(bobChannel, aliceChannel),
        });
      }

      return route.continue();
    });

    await signInAs(page, bob);
    await page.goto(`/home/${bob.slug}/settings/platforms`);

    const row = page.locator(
      `[data-test="connection-row"][data-connection-id="${bobChannel}"]`,
    );
    await row.locator('[data-test="refresh-connection"]').click();

    // The action has answered once a toast shows, whichever it is.
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();

    if (process.env.CAPTURE_EVIDENCE) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({
        path: `${OUT}/kb-127-refused-refresh.png`,
        fullPage: true,
      });
    }

    // The harm first: Google was never asked about Alice's token, and her
    // channel is still active.
    expect(seen.filter((r) => r.refreshToken === 'alice-refresh')).toEqual([]);

    const [aliceRow] = await readRows<{ is_active: boolean }>(
      'platform_connections',
      `id=eq.${aliceChannel}&select=is_active`,
    );
    expect(aliceRow?.is_active).toBe(true);

    // Then what Bob is told.
    await expect(
      page.getByText(
        'That connection no longer exists, or you do not have access to it.',
      ),
    ).toBeVisible();
  });
});
