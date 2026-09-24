import { Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { type Server, createServer } from 'node:http';

import { encryptLikeTheApp } from '../utils/crypto';
import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-45. Whatever a platform answered a disconnect's revoke with, the creator
 * saw the same green "Disconnected" toast. A refusal is now a warning that
 * stays until dismissed and links to the platform's own settings.
 *
 * Driven through YouTube, whose rows the Platforms page lists (X and LinkedIn
 * rows are not rendered there at all — see KB-25). X's two-token revoke and
 * LinkedIn's no-revoke are proven against a local listener in
 * `packages/features/publishing/__tests__/revokers.test.ts`.
 *
 * A local listener stands in for Google's token host (FILM-1801's
 * `VENDOR_URL_GOOGLE_TOKEN`), so what is checked is the request the production
 * build sends and what the creator is shown for Google's answer. It needs a
 * server started for it:
 *
 *   KB25_SANDBOX_PORT=4125 ENCRYPTION_KEY=<the server's>
 *   VENDOR_SANDBOX=1 VENDOR_URL_GOOGLE_TOKEN=http://127.0.0.1:4125
 *
 * in the server's environment (`NODE_ENV=test next start`), and the port and
 * key in this run's. CI's E2E job has none of these, so this file skips there.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const SANDBOX_PORT = process.env.KB25_SANDBOX_PORT;
const GOOGLE_PERMISSIONS =
  'https://security.google.com/settings/security/permissions';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-45-${name}.png` });
}

/** Google's revoke endpoint, answering with whatever `stand.status` says. */
async function startGoogleStandIn(port: number) {
  const seen: string[] = [];
  const stand = { status: 200 };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stand-in');

    seen.push(`${request.method} ${url.pathname}${url.search}`);
    request.resume();
    request.on('end', () => {
      response.statusCode = stand.status;
      response.setHeader('content-type', 'application/json');
      response.end(stand.status === 200 ? '{}' : '{"error":"invalid_token"}');
    });
  });

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));

  return {
    seen,
    stand,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function row(page: Page, connectionId: string) {
  return page.locator(
    `[data-test="connection-row"][data-connection-id="${connectionId}"]`,
  );
}

async function confirmDisconnect(page: Page, connectionId: string) {
  await row(page, connectionId)
    .locator('[data-test="disconnect-connection"]')
    .click();

  const dialog = page.locator('[data-test="disconnect-dialog"]');

  await expect(dialog).toBeVisible();
  await dialog.locator('[data-test="confirm-disconnect"]').click();
  await expect(row(page, connectionId)).toHaveAttribute(
    'data-status',
    'disconnected',
  );
}

test.describe('A revoke the platform did not confirm is shown, not hidden (KB-45)', () => {
  test('Google refuses: a warning that stays and links to Google; Google agrees: the green toast', async ({
    page,
  }) => {
    test.skip(
      !SANDBOX_PORT || !process.env.ENCRYPTION_KEY,
      'Needs the local Google sandbox (KB25_SANDBOX_PORT, ENCRYPTION_KEY)',
    );

    const google = await startGoogleStandIn(Number(SANDBOX_PORT));

    try {
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

      // First submission: Google answers 400.
      google.stand.status = 400;
      await confirmDisconnect(page, refused);

      const warning = page.locator(
        '[data-test="disconnect-revoke-unconfirmed"]',
      );

      await expect(warning).toContainText(
        "Disconnected Acme TV. YouTube didn't confirm it removed our access",
      );
      await expect(
        warning.locator('[data-test="disconnect-revoke-settings-link"]'),
      ).toHaveAttribute('href', GOOGLE_PERMISSIONS);
      await expect(
        page.getByText('Disconnected Acme TV. Your records are kept.'),
      ).toHaveCount(0);
      // It stays until dismissed: the creator has something left to do.
      const toast = page.locator('[data-sonner-toast]').filter({ has: warning });

      await expect(toast.locator('[data-close-button]')).toBeVisible();
      expect(google.seen).toEqual([
        `POST /revoke?token=kb45-refused-${suffix}`,
      ]);
      await capture(page, '01-refused-warning');

      await toast.locator('[data-close-button]').click();
      await expect(warning).toHaveCount(0);

      // Second submission: Google agrees, and the creator is told only that.
      google.stand.status = 200;
      await confirmDisconnect(page, agreed);

      await expect(
        page.getByText('Disconnected Acme Two. Your records are kept.'),
      ).toBeVisible();
      await expect(warning).toHaveCount(0);
      expect(google.seen).toEqual([
        `POST /revoke?token=kb45-refused-${suffix}`,
        `POST /revoke?token=kb45-agreed-${suffix}`,
      ]);
      await capture(page, '02-revoked-success');
    } finally {
      await google.close();
    }
  });
});
