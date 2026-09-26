import { Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  deleteRows,
  readRows,
  seedTeamAccount,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { SUPER_ADMIN_STORAGE_STATE } from '../utils/super-admin';

/**
 * KB-36. /admin/platforms offered a TikTok card whose saved key nothing read:
 * connect, callback, refresh and revoke all took TikTok's app from env. Now
 * a saved key comes first, env is the fallback, and each card says which one
 * is in effect, so a saved value can never again be shown while another is
 * used.
 *
 * Saving encrypts the secret, so the server needs `ENCRYPTION_KEY` (any
 * generated 32-byte key; the same one in this run, which writes an
 * undecryptable row on purpose). CI's E2E server has none, so this file skips
 * there. The connect check also needs `NEXT_PUBLIC_APP_URL` on the server (the
 * route refuses without it), so it runs only with `KB36_CONNECT_CHECK=1`.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/kb-36-${name}.png`, fullPage: true });
}

function tiktokSource(page: Page) {
  return page.locator('[data-test="oauth-app-source-tiktok"]');
}

async function saveTikTok(page: Page, clientKey: string, secret: string) {
  await page
    .locator('[data-test="oauth-app-client-id-tiktok"]')
    .fill(clientKey);
  await page
    .locator('[data-test="oauth-app-client-secret-tiktok"]')
    .fill(secret);
  await page.locator('[data-test="oauth-app-save-tiktok"]').click();
  await expect(page.getByText('TikTok credentials saved!')).toBeVisible();
}

test.describe('TikTok credentials saved at /admin/platforms (KB-36)', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test.skip(
    !process.env.ENCRYPTION_KEY,
    'needs ENCRYPTION_KEY on the server and in this run',
  );

  test.beforeEach(async () => {
    await deleteRows('oauth_app_credentials', 'platform=eq.tiktok');
  });

  test.afterEach(async () => {
    await deleteRows('oauth_app_credentials', 'platform=eq.tiktok');
  });

  test('each card says which credentials are in effect, and a saved TikTok key becomes the one in effect', async ({
    page,
  }) => {
    await page.goto('/admin/platforms');

    // With no row, TikTok is whatever this server's env says: env or none.
    const before = await tiktokSource(page).getAttribute('data-source');
    expect(['env', 'none']).toContain(before);
    await capture(page, '01-before-save');

    const stamp = uniqueStamp();
    await saveTikTok(page, `kb36-key-${stamp}`, `kb36-secret-${stamp}`);

    await expect(tiktokSource(page)).toHaveAttribute('data-source', 'saved');
    await expect(tiktokSource(page)).toHaveText('Saved here');
    await capture(page, '02-after-save');

    const [row] = await readRows<{ client_id: string }>(
      'oauth_app_credentials',
      'platform=eq.tiktok&select=client_id',
    );
    expect(row?.client_id).toBe(`kb36-key-${stamp}`);

    // A second save replaces the first, and the card still reads saved. The
    // first save's toast may still be showing, so wait for the row itself.
    await saveTikTok(page, `kb36-key2-${stamp}`, `kb36-secret2-${stamp}`);
    await expect
      .poll(async () => {
        const [second] = await readRows<{ client_id: string }>(
          'oauth_app_credentials',
          'platform=eq.tiktok&select=client_id',
        );
        return second?.client_id;
      })
      .toBe(`kb36-key2-${stamp}`);
    await expect(tiktokSource(page)).toHaveAttribute('data-source', 'saved');

    // A saved secret the server cannot decrypt is shown as broken, not saved.
    await updateRows('oauth_app_credentials', 'platform=eq.tiktok', {
      client_secret_encrypted: 'not-a-ciphertext',
    });
    await page.reload();
    await expect(tiktokSource(page)).toHaveAttribute(
      'data-source',
      'unreadable',
    );
    await expect(tiktokSource(page)).toHaveText(
      'Saved, but cannot be read. Save it again',
    );
    await capture(page, '03-unreadable');

    // Without the row, the card goes back to what it said before.
    await deleteRows('oauth_app_credentials', 'platform=eq.tiktok');
    await page.reload();
    await expect(tiktokSource(page)).toHaveAttribute('data-source', before!);
  });

  test('TikTok connect sends the saved client key', async ({
    page,
    browser,
  }) => {
    test.skip(
      !process.env.KB36_CONNECT_CHECK,
      'needs NEXT_PUBLIC_APP_URL on the server; set KB36_CONNECT_CHECK=1',
    );

    const stamp = uniqueStamp();
    await page.goto('/admin/platforms');
    await saveTikTok(page, `kb36-connect-${stamp}`, `kb36-secret-${stamp}`);

    const team = await seedTeamAccount({ emailPrefix: 'kb36' });
    // A fresh context with no session: a new context inherits the project's
    // options, the super admin's storageState included.
    const creator = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const creatorPage = await creator.newPage();
    await signInAs(creatorPage, team);

    const response = await creatorPage.request.get(
      `/api/platforms/connect/tiktok?accountId=${team.accountId}`,
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location!);
    expect(location.searchParams.get('client_key')).toBe(
      `kb36-connect-${stamp}`,
    );

    await creator.close();
  });
});
