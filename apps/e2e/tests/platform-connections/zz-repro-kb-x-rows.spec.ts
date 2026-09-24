import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { signInAs } from '../utils/session';

// Throwaway reproduction, not committed: are X / LinkedIn connections listed?
test('repro: X and LinkedIn connections on the Platforms page', async ({ page }) => {
  const team = await seedTeamAccount({ emailPrefix: 'kbxrows' });
  const s = randomUUID().slice(0, 8);
  const ids = {
    youtube: await seedYouTubeConnection(team.accountId, 'Repro YouTube', { platformAccountId: `yt-${s}`, accessTokenEncrypted: 'x' }),
    twitter: await seedYouTubeConnection(team.accountId, 'Repro X', { platform: 'twitter', platformAccountId: `x-${s}`, accessTokenEncrypted: 'x' }),
    linkedin: await seedYouTubeConnection(team.accountId, 'Repro LinkedIn', { platform: 'linkedin', platformAccountId: `li-${s}`, accessTokenEncrypted: 'x' }),
  };
  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/settings/platforms`);
  const row = (id: string) => page.locator(`[data-test="connection-row"][data-connection-id="${id}"]`);
  await expect(row(ids.youtube)).toBeVisible();
  const counts = {
    youtube: await row(ids.youtube).count(),
    twitter: await row(ids.twitter).count(),
    linkedin: await row(ids.linkedin).count(),
    xText: await page.getByText('Repro X').count(),
    linkedinText: await page.getByText('Repro LinkedIn').count(),
    disconnectButtons: await page.locator('[data-test="disconnect-connection"]').count(),
  };
  console.log('REPRO', JSON.stringify(counts));
  await page.screenshot({ path: '/tmp/kb25/repro-x-linkedin-rows-missing.png', fullPage: true });
});
