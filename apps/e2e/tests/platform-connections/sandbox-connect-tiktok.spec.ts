import { expect, test } from '@playwright/test';

import { decryptLikeTheApp } from '../utils/crypto';
import {
  SANDBOX_CONNECT,
  connectionRow,
  consentScopes,
  failNext,
  lastLedgerId,
  ledger,
  openPlatforms,
  platformCard,
  storedConnections,
} from '../utils/sandbox';
import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-706, "Test OAuth flow with mocked TikTok endpoints", at browser level:
 * the real connect route sends the browser to the vendor sandbox's TikTok
 * consent screen (FILM-1802), the person allows or refuses, and the real
 * callback exchanges the code (PKCE), reads the profile and stores the
 * connection. Nothing is mocked in the app; the sandbox is the vendor.
 *
 * Needs the sandbox and an app started with local.env's vendor block; skipped
 * unless SANDBOX_CONNECT=1 (docs/ENGINEERING-WORKFLOW.md, "Sandbox-backed
 * E2E"), so CI, which has neither, does not run it.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

const REQUESTED_SCOPES = [
  'user.info.basic',
  'video.upload',
  'video.publish',
  'video.list',
  'user.info.stats',
];

async function accountOnConsent(page: import('@playwright/test').Page) {
  const line = await byTest(page, 'sandbox-consent-account').innerText();

  return /Signed in as (.+?) \(@/.exec(line)![1]!;
}

test.describe('Connecting TikTok through the sandbox (FILM-706)', () => {
  test.skip(
    !SANDBOX_CONNECT,
    'Set SANDBOX_CONNECT=1, with the sandbox and a local.env app running.',
  );
  // The sandbox has one TikTok account and one failure queue: in order.
  test.describe.configure({ mode: 'default' });

  test('consent, then the row, the stored tokens and scopes, and a second connect', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-tiktok' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    const card = platformCard(page, 'tiktok');
    await expect(connectionRow(page, 'tiktok', '')).toHaveCount(0);

    // --- Connect: the vendor's consent screen names the account and scopes.
    const since = await lastLedgerId();
    await byTest(card, 'connect-platform-tiktok').click();
    await expect(byTest(page, 'sandbox-consent-account')).toBeVisible();
    const name = await accountOnConsent(page);
    await expect(consentScopes(page)).toHaveCount(REQUESTED_SCOPES.length);
    expect(
      await consentScopes(page).evaluateAll((boxes) =>
        boxes.map((box) => (box as HTMLInputElement).value),
      ),
    ).toEqual(REQUESTED_SCOPES);
    if (shoot) await page.screenshot({ path: `${OUT}/tiktok-1-consent.png` });

    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));

    // --- After: one row, named for the vendor's account, not a failure page.
    const row = connectionRow(page, 'tiktok', name);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-status', 'active');
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    if (shoot) await page.screenshot({ path: `${OUT}/tiktok-2-connected.png` });

    const [stored, ...others] = await storedConnections(
      team.accountId,
      'tiktok',
    );
    expect(others).toEqual([]);
    expect(stored).toMatchObject({
      platform_account_name: name,
      is_active: true,
    });
    expect([...stored!.scopes!].sort()).toEqual([...REQUESTED_SCOPES].sort());
    expect(stored!.metadata).toHaveProperty('scopes_granted_at');
    expect(stored!.metadata).toHaveProperty('refresh_expires_at');

    // The stored tokens are the sandbox's own: encrypted at rest, and the
    // decrypted access token is accepted by TikTok's user-info endpoint.
    expect(stored!.access_token_encrypted).toBeTruthy();
    const access = await decryptLikeTheApp(stored!.access_token_encrypted!);
    const refresh = await decryptLikeTheApp(stored!.refresh_token_encrypted!);
    expect(access).not.toBe(refresh);
    const info = await fetch(
      'http://127.0.0.1:4102/v2/user/info/?fields=open_id,display_name',
      { headers: { Authorization: `Bearer ${access}` } },
    );
    expect(info.status).toBe(200);
    expect(
      ((await info.json()) as { data: { user: { open_id: string } } }).data.user
        .open_id,
    ).toBe(stored!.platform_account_id);

    const calls = (await ledger('tiktok', since)).map(
      (entry) => `${entry.method} ${entry.path} ${entry.status}`,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'GET /v2/auth/authorize/ 200',
        'POST /v2/oauth/token/ 200',
      ]),
    );

    // --- Second connect, from the state the first left behind: the same
    // account reconnects into the same row with fresh tokens.
    await page.reload();
    await expect(row).toHaveCount(1);
    await byTest(card, 'connect-platform-tiktok').click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(row).toHaveCount(1);

    const after = await storedConnections(team.accountId, 'tiktok');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(stored!.id);
    expect(await decryptLikeTheApp(after[0]!.access_token_encrypted!)).not.toBe(
      access,
    );
  });

  test('a scope the person unticks is not recorded, and the page says which analytics it cost', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-tiktok-scope' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    await byTest(
      platformCard(page, 'tiktok'),
      'connect-platform-tiktok',
    ).click();
    await page.getByRole('checkbox', { name: 'video.list' }).uncheck();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));

    const [stored] = await storedConnections(team.accountId, 'tiktok');
    expect(stored!.scopes).not.toContain('video.list');
    expect(stored!.scopes).toContain('video.upload');

    const notice = byTest(page, 'analytics-access-notice');
    await expect(notice).toBeVisible();
    await expect(
      notice.locator('[data-requirement="tiktok.video-metrics"]'),
    ).toHaveAttribute('data-state', /^(?!authorised$).+/);
    if (shoot)
      await page.screenshot({ path: `${OUT}/tiktok-3-scope-notice.png` });
  });

  test('cancelling at consent, then a vendor error at the token exchange, store nothing; the retry connects', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-tiktok-fail' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);
    const connect = byTest(
      platformCard(page, 'tiktok'),
      'connect-platform-tiktok',
    );

    // --- The person cancels on the vendor's screen.
    await connect.click();
    await byTest(page, 'sandbox-consent-deny').click();
    const failure = byTest(page, 'connect-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-code', 'access_denied');
    await expect(failure).toHaveAttribute('data-platform', 'tiktok');
    expect(await storedConnections(team.accountId, 'tiktok')).toEqual([]);
    if (shoot) await page.screenshot({ path: `${OUT}/tiktok-4-declined.png` });

    // --- The vendor fails the code exchange itself.
    await failNext({
      vendor: 'tiktok',
      status: 500,
      pathIncludes: '/v2/oauth/token',
    });
    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-code', 'token_exchange_failed');
    expect(await storedConnections(team.accountId, 'tiktok')).toEqual([]);
    if (shoot)
      await page.screenshot({ path: `${OUT}/tiktok-5-token-failed.png` });

    // --- Second submission: nothing was left half-done, so it connects.
    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    await expect(
      byTest(platformCard(page, 'tiktok'), 'connection-row'),
    ).toHaveCount(1);
    expect(await storedConnections(team.accountId, 'tiktok')).toHaveLength(1);
  });
});
