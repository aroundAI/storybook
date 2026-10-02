import { expect, test } from '@playwright/test';

import { decryptLikeTheApp } from '../utils/crypto';
import {
  connectThroughSandbox,
  connectionById,
  cronHeaders,
  lastLedgerId,
  ledger,
  openPlatforms,
  sandboxRun,
  storedConnections,
  vendorAccepts,
} from '../utils/sandbox';
import { seedTeamAccount, updateRows } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1804 §2 "Disconnect and reconnect" and "Token refresh", against the
 * sandbox: the revoke reaches the vendor and the vendor then refuses the
 * old token; the reconnect is a fresh grant into the same row; and a token
 * near expiry is refreshed by the real cron route, the vendor accepting the
 * new one.
 *
 * X has a
 * refresh path today (`refreshXToken`), so it is refreshed here rather than
 * recorded as a gap, as the spec's §2 expected when it was written.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

const REVOKES = [
  { card: 'youtube', vendor: 'google', revokePath: '/revoke' },
  { card: 'tiktok', vendor: 'tiktok', revokePath: '/v2/oauth/revoke/' },
  { card: 'twitter', vendor: 'x', revokePath: '/2/oauth2/revoke' },
] as const;

const REFRESHES = [
  { card: 'youtube', vendor: 'google', tokenPath: '/token' },
  { card: 'tiktok', vendor: 'tiktok', tokenPath: '/v2/oauth/token/' },
  { card: 'twitter', vendor: 'x', tokenPath: '/2/oauth2/token' },
  { card: 'facebook', vendor: 'meta', tokenPath: '/oauth/access_token' },
] as const;

test.describe('Disconnect, reconnect and token refresh, against the sandbox (FILM-1804)', () => {
  sandboxRun();

  for (const { card, vendor, revokePath } of REVOKES) {
    test(`${card}: disconnect revokes at the vendor, which then refuses the token; reconnect is a fresh grant into the same row`, async ({
      page,
    }) => {
      const team = await seedTeamAccount({ emailPrefix: `sbx-revoke-${card}` });
      await signInAs(page, team);
      await connectThroughSandbox(page, team.slug, card);
      const [connected] = await storedConnections(team.accountId, card);
      const access = await decryptLikeTheApp(
        connected!.access_token_encrypted!,
      );
      expect(await vendorAccepts(card, access)).toBe(200);

      // --- Disconnect: the dialog, then the vendor's revoke.
      const since = await lastLedgerId();
      const row = connectionById(page, connected!.id);
      await byTest(row, 'disconnect-connection').click();
      await byTest(page, 'confirm-disconnect').click();
      await expect(row).toHaveAttribute('data-status', 'disconnected');
      await expect(
        page.getByText(/Disconnected .+ Your records are kept\./),
      ).toBeVisible();
      await expect(byTest(page, 'disconnect-revoke-unconfirmed')).toHaveCount(
        0,
      );
      if (shoot)
        await page.screenshot({
          path: `${OUT}/${card}-revoke-1-disconnected.png`,
        });

      const revokes = (await ledger(vendor, since)).filter(
        (entry) => entry.path === revokePath,
      );
      expect(revokes.length).toBeGreaterThan(0);
      expect(revokes.every((entry) => entry.status === 200)).toBe(true);
      // The vendor's answer to the old token, not our row, is the proof.
      expect(await vendorAccepts(card, access)).not.toBe(200);

      // --- Reconnect, the second submission: the same row, a new grant.
      await byTest(row, 'reconnect-connection').click();
      await byTest(page, 'sandbox-consent-allow').click();
      await page.waitForURL(
        new RegExp(`/home/${team.slug}/settings/platforms`),
      );
      await expect(connectionById(page, connected!.id)).toHaveAttribute(
        'data-status',
        'active',
      );

      const [again, ...more] = await storedConnections(team.accountId, card);
      expect(more).toEqual([]);
      expect(again!.id).toBe(connected!.id);
      const fresh = await decryptLikeTheApp(again!.access_token_encrypted!);
      expect(fresh).not.toBe(access);
      expect(await vendorAccepts(card, fresh)).toBe(200);
      expect(await vendorAccepts(card, access)).not.toBe(200);
    });
  }

  for (const { card, vendor, tokenPath } of REFRESHES) {
    test(`${card}: a token near expiry is refreshed by the cron route, and the vendor accepts the new one`, async ({
      page,
    }) => {
      const team = await seedTeamAccount({
        emailPrefix: `sbx-refresh-${card}`,
      });
      await signInAs(page, team);
      await connectThroughSandbox(page, team.slug, card);
      // Facebook connects the Page and its Instagram account; the Page's row
      // holds the long-lived user token that refresh exchanges.
      const [connected] = await storedConnections(team.accountId, card);
      const before = await decryptLikeTheApp(
        connected!.access_token_encrypted!,
      );

      // Five minutes from expiry: inside the cron's window.
      await updateRows('platform_connections', `id=eq.${connected!.id}`, {
        token_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });

      const since = await lastLedgerId();
      const response = await page.request.get('/api/cron/refresh-tokens', {
        headers: cronHeaders(),
        timeout: 120_000,
      });
      expect(response.status(), await response.text()).toBe(200);

      expect(
        (await ledger(vendor, since))
          .filter((entry) => entry.path.endsWith(tokenPath))
          .map((entry) => entry.status),
      ).toContain(200);

      const [after] = await storedConnections(team.accountId, card);
      expect(after!.is_active).toBe(true);
      const refreshed = await decryptLikeTheApp(after!.access_token_encrypted!);
      expect(refreshed).not.toBe(before);
      expect(await vendorAccepts(card, refreshed)).toBe(200);

      await openPlatforms(page, team.slug);
      await expect(connectionById(page, connected!.id)).toHaveAttribute(
        'data-status',
        'active',
      );
    });
  }
});
