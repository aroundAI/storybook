import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-205. YouTube abandons a video over 15 minutes from an unverified
 * channel, so Platform Connections says which channels are not verified for
 * long uploads, and which were never checked. A verified one says nothing.
 *
 * Evidence, not a guard: the unit suites hold the rules. Skipped unless
 * CAPTURE_EVIDENCE is set, so CI pays nothing for it.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await byTest(page, 'platform-card-youtube').screenshot({
    path: `${OUT}/kb-205-${name}.png`,
  });
}

test.describe('YouTube long uploads on Platform Connections — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('an unverified channel says so; a verified one does not', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb205-long-uploads' });

    await seedYouTubeConnection(team.accountId, 'Verified Channel', {
      metadata: { long_uploads_status: 'allowed' },
    });
    await seedYouTubeConnection(team.accountId, 'Fault & Frontier', {
      metadata: { long_uploads_status: 'eligible' },
    });
    await seedYouTubeConnection(team.accountId, 'Connected Before KB-205');

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    const lines = byTest(page, 'youtube-long-uploads');

    await expect(lines).toHaveCount(2);
    await expect(
      page.locator(
        '[data-test="youtube-long-uploads"][data-status="eligible"]',
      ),
    ).toHaveText('Long uploads: not verified (15-minute limit) Verify');
    await expect(
      page.locator('[data-test="youtube-long-uploads"][data-status="unknown"]'),
    ).toHaveText('Long uploads: not checked yet. Press Refresh to check');

    await capture(page, '01-platform-connections');
  });
});
