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
 * FILM-715, "Test OAuth flow with mock API", at browser level, for personal
 * profiles: the real connect route sends the browser to the sandbox's
 * LinkedIn consent screen (FILM-1802), and the real callback exchanges the
 * code, reads the OpenID userinfo and stores the connection.
 *
 * Not driven, because the product has nothing to drive (FILM-715 `remaining`):
 * company pages (no UI offers `type=company`, and the callback would store
 * the member URN anyway), analytics retrieval (`getPostMetrics` has no
 * caller, and the sandbox serves no analytics) and delete post (`deletePost`
 * has no caller; unpublish skips LinkedIn). Publishing itself is KB-141's.
 *
 * Skipped unless SANDBOX_E2E=1 (docs/ENGINEERING-WORKFLOW.md,
 * "Sandbox-backed E2E"); CI has no sandbox.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);
const API = 'http://127.0.0.1:4105';

const PERSONAL_SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

async function memberOnConsent(page: Page) {
  const line = await byTest(page, 'sandbox-consent-account').innerText();

  return /Signed in as (.+?) \(@/.exec(line)![1]!;
}

test.describe('Connecting LinkedIn through the sandbox (FILM-715)', () => {
  // One LinkedIn member in the sandbox, and one failure queue: in order.
  sandboxRun();

  test('consent, then the member connected with tokens and scopes, and a second connect', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-linkedin' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    const card = platformCard(page, 'linkedin');
    await expect(byTest(card, 'connection-row')).toHaveCount(0);

    // --- Connect: the consent screen names the member and the personal scopes.
    const since = await lastLedgerId();
    await byTest(card, 'connect-platform-linkedin').click();
    await expect(byTest(page, 'sandbox-consent-account')).toBeVisible();
    const name = await memberOnConsent(page);
    expect(
      await consentScopes(page).evaluateAll((boxes) =>
        boxes.map((box) => (box as HTMLInputElement).value),
      ),
    ).toEqual(PERSONAL_SCOPES);
    if (shoot) await page.screenshot({ path: `${OUT}/linkedin-1-consent.png` });

    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));

    // --- After: one row for the member, no failure page.
    const row = connectionRow(page, 'linkedin', name);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-status', 'active');
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    if (shoot)
      await page.screenshot({ path: `${OUT}/linkedin-2-connected.png` });

    const [stored, ...others] = await storedConnections(
      team.accountId,
      'linkedin',
    );
    expect(others).toEqual([]);
    expect(stored).toMatchObject({
      platform_account_name: name,
      is_active: true,
    });
    expect(stored!.platform_account_id).toMatch(/^urn:li:person:.+/);
    expect([...stored!.scopes!].sort()).toEqual([...PERSONAL_SCOPES].sort());
    expect(stored!.metadata).toMatchObject({ isCompanyPage: false });

    // The stored access token is the sandbox's: accepted by userinfo, and
    // userinfo names the member the row is for.
    const access = await decryptLikeTheApp(stored!.access_token_encrypted!);
    expect(stored!.refresh_token_encrypted).toBeTruthy();
    const userinfo = await fetch(`${API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    expect(userinfo.status).toBe(200);
    const claims = (await userinfo.json()) as { sub: string; name: string };
    expect(`urn:li:person:${claims.sub}`).toBe(stored!.platform_account_id);
    expect(claims.name).toBe(name);

    const calls = (await ledger('linkedin', since)).map(
      (entry) => `${entry.method} ${entry.path} ${entry.status}`,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'GET /oauth/v2/authorization 200',
        'POST /oauth/v2/accessToken 200',
        'GET /v2/userinfo 200',
      ]),
    );

    // --- Second connect, from the state the first left: the same member
    // reconnects into the same row with a fresh token.
    await page.reload();
    await expect(row).toHaveCount(1);
    await byTest(card, 'connect-platform-linkedin').click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(row).toHaveCount(1);

    const after = await storedConnections(team.accountId, 'linkedin');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(stored!.id);
    expect(await decryptLikeTheApp(after[0]!.access_token_encrypted!)).not.toBe(
      access,
    );
  });

  test('cancelling on the consent screen, then a vendor error at the token exchange, store nothing; the retry connects', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-linkedin-fail' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);
    const connect = byTest(
      platformCard(page, 'linkedin'),
      'connect-platform-linkedin',
    );
    const failure = byTest(page, 'connect-failure');

    await connect.click();
    await byTest(page, 'sandbox-consent-deny').click();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-platform', 'linkedin');
    expect(await storedConnections(team.accountId, 'linkedin')).toEqual([]);
    if (shoot)
      await page.screenshot({ path: `${OUT}/linkedin-3-declined.png` });

    await failNext({
      vendor: 'linkedin',
      status: 500,
      pathIncludes: '/oauth/v2/accessToken',
    });
    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-code', 'token_exchange_failed');
    expect(await storedConnections(team.accountId, 'linkedin')).toEqual([]);
    if (shoot)
      await page.screenshot({ path: `${OUT}/linkedin-4-token-failed.png` });

    await connect.click();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));
    await expect(byTest(page, 'connect-failure')).toHaveCount(0);
    await expect(
      byTest(platformCard(page, 'linkedin'), 'connection-row'),
    ).toHaveCount(1);
    expect(await storedConnections(team.accountId, 'linkedin')).toHaveLength(1);
  });

  // KB-145: the callback records the `scope` LinkedIn's token response says
  // was granted, not the list it asked for. Real LinkedIn's consent is
  // all-or-nothing; the sandbox lets a scope be unticked so the grant can
  // differ from the request.
  test('a scope the person unticks is not recorded as granted', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'sbx-linkedin-scope' });
    await signInAs(page, team);
    await openPlatforms(page, team.slug);

    await byTest(
      platformCard(page, 'linkedin'),
      'connect-platform-linkedin',
    ).click();
    await page.getByRole('checkbox', { name: 'w_member_social' }).uncheck();
    await byTest(page, 'sandbox-consent-allow').click();
    await page.waitForURL(new RegExp(`/home/${team.slug}/settings/platforms`));

    const [stored] = await storedConnections(team.accountId, 'linkedin');
    expect([...stored!.scopes!].sort()).toEqual(['email', 'openid', 'profile']);
  });
});
