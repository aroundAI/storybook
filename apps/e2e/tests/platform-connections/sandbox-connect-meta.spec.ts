import { Page, expect, test } from '@playwright/test';

import { decryptLikeTheApp } from '../utils/crypto';
import {
  connectionRow,
  consentScopes,
  failNext,
  lastLedgerId,
  ledger,
  openPlatforms,
  platformCard,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-707, "Test OAuth flow with mocked Meta endpoints", at browser level:
 * the real connect route sends the browser to the sandbox's Facebook Login
 * dialog (FILM-1802), and the real callback exchanges the code for a short
 * then a long-lived token, lists the Pages (`/me/accounts`) with their linked
 * Instagram accounts, reads the granted permissions and stores one row for
 * each Page and each Instagram account.
 *
 * "User can select which Pages to connect" is not driven: there is no in-app
 * choice, and the owner decided on 2026-09-30 that there should not be one
 * (FILM-707 test_plan: every Page Meta returns is connected). What is driven
 * is the consequence: every Page the vendor lists is connected, and the
 * person's only choice is on Meta's own dialog, where they can decline.
 *
 * Skipped unless SANDBOX_E2E=1 (docs/ENGINEERING-WORKFLOW.md,
 * "Sandbox-backed E2E"); CI has no sandbox.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);
const GRAPH = 'http://127.0.0.1:4101';

const REQUESTED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'business_management',
];

async function pageOnDialog(page: Page) {
  const line = await byTest(page, 'sandbox-consent-account').innerText();

  return /Signed in as (.+?) \(@/.exec(line)![1]!;
}

test.describe('Connecting Facebook and Instagram through the sandbox (FILM-707)', () => {
  // One Meta user in the sandbox, and one failure queue: in order.
  sandboxRun();

  test('the dialog, then the Page and its Instagram account connected with their tokens and granted permissions, and a second connect', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-meta' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    await expect(
      byTest(platformCard(page, 'facebook'), 'connection-row'),
    ).toHaveCount(0);
    await expect(
      byTest(platformCard(page, 'instagram'), 'connection-row'),
    ).toHaveCount(0);

    // --- Connect from the Facebook card: Facebook Login's dialog.
    const since = await lastLedgerId();
    await byTest(
      platformCard(page, 'facebook'),
      'connect-platform-facebook',
    ).click();
    await expect(byTest(page, 'sandbox-consent-account')).toBeVisible();
    const pageName = await pageOnDialog(page);
    expect(
      await consentScopes(page).evaluateAll((boxes) =>
        boxes.map((box) => (box as HTMLInputElement).value),
      ),
    ).toEqual(REQUESTED_SCOPES);
    if (shoot) await page.screenshot({ path: `${OUT}/meta-1-dialog.png` });

    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));

    // --- After: the Page under Facebook, the linked account under Instagram.
    const facebookRow = connectionRow(page, 'facebook', pageName);
    await expect(facebookRow).toHaveCount(1);
    await expect(facebookRow).toHaveAttribute('data-status', 'active');
    await expect(
      byTest(platformCard(page, 'instagram'), 'connection-row'),
    ).toHaveCount(1);
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    if (shoot)
      await page.screenshot({
        path: `${OUT}/meta-2-connected.png`,
        fullPage: true,
      });

    const [facebook, ...moreFacebook] = await storedConnections(
      team.accountId,
      'facebook',
    );
    const [instagram, ...moreInstagram] = await storedConnections(
      team.accountId,
      'instagram',
    );
    expect(moreFacebook).toEqual([]);
    expect(moreInstagram).toEqual([]);
    expect(facebook).toMatchObject({
      platform_account_name: pageName,
      is_active: true,
    });
    expect(instagram!.metadata).toMatchObject({
      linked_page_id: facebook!.platform_account_id,
    });
    // What the person granted, recorded on both rows.
    for (const row of [facebook!, instagram!]) {
      expect([...row.scopes!].sort()).toEqual([...REQUESTED_SCOPES].sort());
    }

    // The tokens are the sandbox's: the Page token on both rows, the
    // long-lived user token kept for refresh, both accepted by the Graph API.
    const pageToken = await decryptLikeTheApp(
      facebook!.access_token_encrypted!,
    );
    const userToken = await decryptLikeTheApp(
      facebook!.refresh_token_encrypted!,
    );
    expect(pageToken).not.toBe(userToken);
    expect(await decryptLikeTheApp(instagram!.access_token_encrypted!)).toBe(
      pageToken,
    );
    for (const token of [pageToken, userToken]) {
      const permissions = await fetch(
        `${GRAPH}/v18.0/me/permissions?access_token=${encodeURIComponent(token)}`,
      );
      expect(permissions.status).toBe(200);
    }

    const calls = (await ledger('meta', since)).map(
      (entry) =>
        `${entry.method} ${entry.path.replace(/^\/v[\d.]+/, '')} ${entry.status}`,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'GET /dialog/oauth 200',
        'GET /oauth/access_token 200',
        'GET /me/accounts 200',
        'GET /me/permissions 200',
      ]),
    );

    // --- Second connect, from the Instagram card, into the state the first
    // left: the same Page and account again, not a second pair of rows.
    await page.reload();
    await byTest(
      platformCard(page, 'instagram'),
      'connect-platform-instagram',
    ).click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(
      byTest(platformCard(page, 'facebook'), 'connection-row'),
    ).toHaveCount(1);
    await expect(
      byTest(platformCard(page, 'instagram'), 'connection-row'),
    ).toHaveCount(1);

    const again = await storedConnections(team.accountId, 'facebook');
    expect(again.map((row) => row.id)).toEqual([facebook!.id]);
    expect(await storedConnections(team.accountId, 'instagram')).toHaveLength(
      1,
    );
    expect(
      await decryptLikeTheApp(again[0]!.refresh_token_encrypted!),
    ).not.toBe(userToken);
  });

  test('declining the Pages permission on the dialog connects nothing and says why', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-meta-perm' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    await byTest(
      platformCard(page, 'facebook'),
      'connect-platform-facebook',
    ).click();
    await page.getByRole('checkbox', { name: 'pages_show_list' }).uncheck();
    await byTest(page, 'sandbox-consent-allow').click();

    const failure = byTest(page, 'connect-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-platform', 'meta');
    await expect(failure).toHaveAttribute('data-code', 'account_lookup_failed');
    expect(await storedConnections(team.accountId, 'facebook')).toEqual([]);
    expect(await storedConnections(team.accountId, 'instagram')).toEqual([]);
    await expect(platformCard(page, 'facebook')).toBeVisible();
    if (shoot)
      await page.screenshot({ path: `${OUT}/meta-3-pages-declined.png` });
  });

  test('cancelling on the dialog, then a vendor error at the token exchange, store nothing; the retry connects', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-meta-fail' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);
    const connect = byTest(
      platformCard(page, 'facebook'),
      'connect-platform-facebook',
    );
    const failure = byTest(page, 'connect-failure');

    await connect.click();
    await byTest(page, 'sandbox-consent-deny').click();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-code', 'access_denied');
    expect(await storedConnections(team.accountId, 'facebook')).toEqual([]);
    if (shoot) await page.screenshot({ path: `${OUT}/meta-4-declined.png` });

    await failNext({
      vendor: 'meta',
      status: 500,
      pathIncludes: '/oauth/access_token',
    });
    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-code', 'token_exchange_failed');
    expect(await storedConnections(team.accountId, 'facebook')).toEqual([]);
    expect(await storedConnections(team.accountId, 'instagram')).toEqual([]);

    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    await expect(
      byTest(platformCard(page, 'facebook'), 'connection-row'),
    ).toHaveCount(1);
    expect(await storedConnections(team.accountId, 'facebook')).toHaveLength(1);
  });
});
