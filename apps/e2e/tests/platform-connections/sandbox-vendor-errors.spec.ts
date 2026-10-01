import { expect, test } from '@playwright/test';

import {
  connectThroughSandbox,
  connectionById,
  cronHeaders,
  failNext,
  openPlatforms,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import { readRows, seedTeamAccount, updateRows } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1804 §2 "Vendor errors", for a connection: what the person is told
 * when the vendor refuses, driven with POST /__sandbox/fail.
 *
 * - An expired grant: the vendor refuses the refresh, and the connection
 *   reads Expired with a Reconnect button (and a notification says so);
 *   reconnecting makes it active again.
 * - A 5xx at the revoke: the disconnect still happens, and the warning says
 *   the platform did not confirm it and where to remove access (KB-45).
 *
 * The rate limit and the 5xx on an upload are `sandbox-publish.spec.ts`'s;
 * a 5xx at the token exchange is in each `sandbox-connect-*.spec.ts`.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

test.describe('Vendor errors on a connection, against the sandbox (FILM-1804)', () => {
  sandboxRun();

  test('the vendor refuses the refresh: the row says Expired and offers Reconnect, which makes it active again', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-expired' });
    await signInAs(page, team);
    await connectThroughSandbox(page, team.slug, 'youtube');
    const [connected] = await storedConnections(team.accountId, 'youtube');

    await updateRows('platform_connections', `id=eq.${connected!.id}`, {
      token_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    await failNext({ vendor: 'google', status: 400, pathIncludes: '/token' });
    const response = await page.request.get('/api/cron/refresh-tokens', {
      headers: cronHeaders(),
      timeout: 120_000,
    });
    expect(response.status(), await response.text()).toBe(200);

    await openPlatforms(page, team.slug);
    const row = connectionById(page, connected!.id);
    await expect(row).toHaveAttribute('data-status', 'expired');
    await expect(row).toContainText('Expired');
    await expect(byTest(row, 'reconnect-expired')).toBeVisible();
    await expect(byTest(row, 'refresh-connection')).toHaveCount(0);
    if (shoot) await page.screenshot({ path: `${OUT}/errors-1-expired.png` });

    const notifications = await readRows<{ body: string; link: string }>(
      'notifications',
      `account_id=eq.${team.accountId}&select=body,link`,
    );
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.stringContaining('connection has expired'),
        }),
      ]),
    );

    // --- Reconnect, the second submission.
    await byTest(row, 'reconnect-expired').click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(connectionById(page, connected!.id)).toHaveAttribute(
      'data-status',
      'active',
    );
    const [after] = await storedConnections(team.accountId, 'youtube');
    expect(after!.is_active).toBe(true);
  });

  test('a 5xx at the revoke: disconnected, and told the platform did not confirm it, with where to remove access', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-revoke-5xx' });
    await signInAs(page, team);
    await connectThroughSandbox(page, team.slug, 'youtube');
    const [connected] = await storedConnections(team.accountId, 'youtube');

    await failNext({ vendor: 'google', status: 503, pathIncludes: '/revoke' });
    const row = connectionById(page, connected!.id);
    await byTest(row, 'disconnect-connection').click();
    await byTest(page, 'confirm-disconnect').click();

    // The revoke is awaited before the row changes, so this waits on it.
    await expect(row).toHaveAttribute('data-status', 'disconnected', {
      timeout: 60_000,
    });
    const warning = byTest(page, 'disconnect-revoke-unconfirmed');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('YouTube');
    await expect(
      byTest(warning, 'disconnect-revoke-settings-link'),
    ).toHaveAttribute('href', /^https:\/\//);
    if (shoot)
      await page.screenshot({ path: `${OUT}/errors-2-revoke-unconfirmed.png` });
  });
});
