import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { OFFERED_PLATFORMS } from '../../../../packages/features/publishing/src/lib/platforms';
import {
  addProjectChannels,
  episodeVideoUrl,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-717. LinkedIn is removed from the product (owner, 2026-10-02). Old
 * LinkedIn rows are kept in the database, but no surface shows one, offers
 * LinkedIn or can create a LinkedIn row. No vendor is involved, so this runs
 * against any server.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({
    path: `${OUT}/film-717-${name}.png`,
    fullPage: true,
  });
}

// The offered platforms: X is hidden while `X_ENABLED` is off.
const SUPPORTED = OFFERED_PLATFORMS;

test.describe('LinkedIn is removed (FILM-717)', () => {
  test('Platform Connections offers no LinkedIn and shows no kept LinkedIn row', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-kept' });

    await seedYouTubeConnection(team.accountId, 'Acme on LinkedIn', {
      platform: 'linkedin',
    });
    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    for (const platform of SUPPORTED) {
      await expect(byTest(page, `platform-card-${platform}`)).toBeVisible();
    }
    await expect(byTest(page, 'platform-card-linkedin')).toHaveCount(0);
    await expect(byTest(page, 'connect-platform-linkedin')).toHaveCount(0);
    await expect(page.getByText('Acme on LinkedIn')).toHaveCount(0);
    await expect(page.getByText('LinkedIn')).toHaveCount(0);
    await capture(page, '01-platforms-without-linkedin');
  });

  test('the LinkedIn connect and callback routes are gone', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-routes' });

    await signInAs(page, team);

    for (const path of [
      `/api/platforms/connect/linkedin?account=${team.slug}`,
      '/api/platforms/callback/linkedin?code=late&state=late',
    ]) {
      const response = await page.request.get(path, { maxRedirects: 0 });

      expect(response.status(), path).toBe(404);
    }
  });

  test('the publish screen lists the team’s channels without LinkedIn', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-publish' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      localized_videos: { en: episodeVideoUrl(episodeId) },
    });
    // Both are the project's, so only the removed platform can hide one
    await addProjectChannels(project.id, [
      await seedYouTubeConnection(team.accountId, 'Acme TV'),
      await seedYouTubeConnection(team.accountId, 'Acme on LinkedIn', {
        platform: 'linkedin',
      }),
    ]);

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const youtube = visible(
      page,
      '[data-test="channel-badge"][data-platform="youtube"]',
    );

    await expect(youtube).not.toHaveCount(0);
    await expect(
      visible(page, '[data-test="channel-badge"][data-platform="linkedin"]'),
    ).toHaveCount(0);
    await expect(page.getByText('Acme on LinkedIn')).toHaveCount(0);
    await youtube.first().scrollIntoViewIfNeeded();
    await capture(page, '02-publish-screen');
  });
});
