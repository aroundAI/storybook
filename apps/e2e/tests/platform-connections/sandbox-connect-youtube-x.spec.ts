import { type Page, expect, test } from '@playwright/test';

import { decryptLikeTheApp } from '../utils/crypto';
import {
  connectionRow,
  consentScopes,
  lastLedgerId,
  ledger,
  openPlatforms,
  platformCard,
  sandboxRun,
  storedConnections,
  vendorAccepts,
} from '../utils/sandbox';
import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1804 §2 "Connect, one per platform", for the two platforms the
 * TikTok and Meta specs leave: YouTube and X (LinkedIn is retired, FILM-717). The real connect
 * route sends the browser to the sandbox's consent screen (FILM-1802), the
 * real callback exchanges the code and stores the connection, and a second
 * connect into the state the first left re-attaches the same row with a
 * fresh grant.
 *
 * X has a card and a button since KB-86, so it is driven like the others
 * rather than recorded as a gap (the spec's §2 predates KB-86).
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

// The row is named for the channel on YouTube and for the @handle on X,
// which is how each platform names an account.
const CASES = [
  { card: 'youtube', vendor: 'google', tokenPath: '/token', by: 'name' },
  { card: 'twitter', vendor: 'x', tokenPath: '/2/oauth2/token', by: 'handle' },
] as const;

async function accountOnConsent(page: Page, by: 'name' | 'handle') {
  const line = await byTest(page, 'sandbox-consent-account').innerText();
  const [, name, handle] = /Signed in as (.+?) \(@(.+?)\)/.exec(line)!;

  return by === 'name' ? name! : handle!;
}

test.describe('Connecting YouTube and X through the sandbox (FILM-1804)', () => {
  sandboxRun();

  for (const { card, vendor, tokenPath, by } of CASES) {
    test(`${card}: consent, the row with the scopes asked for, tokens the vendor accepts, and a second connect`, async ({
      page,
    }) => {
      const team = await seedTeamAccount({ emailPrefix: `sbx-${card}` });
      await signInAs(page, team);
      await openPlatforms(page, team.slug);
      const connect = byTest(
        platformCard(page, card),
        `connect-platform-${card}`,
      );

      const since = await lastLedgerId();
      await connect.click();
      await expect(byTest(page, 'sandbox-consent-account')).toBeVisible();
      const name = await accountOnConsent(page, by);
      const asked = await consentScopes(page).evaluateAll((boxes) =>
        boxes.map((box) => (box as HTMLInputElement).value),
      );
      expect(asked.length).toBeGreaterThan(0);
      if (shoot)
        await page.screenshot({ path: `${OUT}/${card}-1-consent.png` });

      await byTest(page, 'sandbox-consent-allow').click();
      await page.waitForURL(
        new RegExp(`/home/${team.slug}/settings/platforms`),
      );

      const row = connectionRow(page, card, name);
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-status', 'active');
      await expect(byTest(page, 'connect-failure')).toHaveCount(0);
      if (shoot)
        await page.screenshot({ path: `${OUT}/${card}-2-connected.png` });

      const [stored, ...others] = await storedConnections(team.accountId, card);
      expect(others).toEqual([]);
      expect(stored).toMatchObject({
        platform_account_name: name,
        is_active: true,
      });
      expect([...stored!.scopes!].sort()).toEqual([...asked].sort());

      const access = await decryptLikeTheApp(stored!.access_token_encrypted!);
      expect(await vendorAccepts(card, access)).toBe(200);
      expect(
        (await ledger(vendor, since)).map(
          (entry) => `${entry.method} ${entry.path} ${entry.status}`,
        ),
      ).toContain(`POST ${tokenPath} 200`);

      // --- Second connect, from the state the first left behind.
      await page.reload();
      await connect.click();
      await byTest(page, 'sandbox-consent-allow').click();
      await page.waitForURL(
        new RegExp(`/home/${team.slug}/settings/platforms`),
      );
      await expect(row).toHaveCount(1);

      const after = await storedConnections(team.accountId, card);
      expect(after.map((connection) => connection.id)).toEqual([stored!.id]);
      const fresh = await decryptLikeTheApp(after[0]!.access_token_encrypted!);
      expect(fresh).not.toBe(access);
      expect(await vendorAccepts(card, fresh)).toBe(200);
    });
  }
});
