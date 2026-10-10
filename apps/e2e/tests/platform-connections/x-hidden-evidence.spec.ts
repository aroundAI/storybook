import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
import { X_ENABLED } from '../utils/x-switch';

/**
 * X is retired for now by the owner, 2026-10-02: hidden behind `X_ENABLED`,
 * its code and its rows kept. Screenshots of what a team with a kept X
 * connection now sees: Platform Connections, the publish screen, the new
 * project form and the analytics platform filter, none offering X.
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
  await page.screenshot({
    path: `${OUT}/x-hidden-${name}.png`,
    fullPage: true,
  });
}

/** A team with a YouTube channel and a kept X connection. */
async function teamWithKeptX(prefix: string) {
  const team = await seedTeamAccount({ emailPrefix: prefix });

  const connectionIds = [
    await seedYouTubeConnection(team.accountId, 'Acme TV'),
    await seedYouTubeConnection(team.accountId, 'acme_on_x', {
      platform: 'twitter',
    }),
  ];

  return { ...team, connectionIds };
}

test.describe('X is hidden — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );
  test.skip(X_ENABLED, 'X is switched on: there is nothing hidden to show.');

  test('Platform Connections offers no X and shows no kept X row', async ({
    page,
  }) => {
    const team = await teamWithKeptX('x-hidden-connect');

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
      await expect(byTest(page, `platform-card-${platform}`)).toBeVisible();
    }
    await expect(byTest(page, 'platform-card-twitter')).toHaveCount(0);
    await expect(byTest(page, 'connect-platform-twitter')).toHaveCount(0);
    await expect(page.getByText('acme_on_x')).toHaveCount(0);
    await capture(page, '01-platform-connections');

    const response = await page.request.get(
      `/api/platforms/connect/twitter?account=${team.slug}`,
      { maxRedirects: 0 },
    );

    expect(response.status()).toBe(404);
  });

  test('the publish screen lists the YouTube channel and not the kept X one', async ({
    page,
  }) => {
    const team = await teamWithKeptX('x-hidden-publish');
    const project = await seedProject(team);
    // Both are the project's, so only the hidden platform can hide one
    await addProjectChannels(project.id, team.connectionIds);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      localized_videos: { en: episodeVideoUrl(episodeId) },
    });

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
      visible(page, '[data-test="channel-badge"][data-platform="twitter"]'),
    ).toHaveCount(0);
    await expect(page.getByText('acme_on_x')).toHaveCount(0);
    await youtube.first().scrollIntoViewIfNeeded();
    await capture(page, '02-publish-screen');
  });

  test('a new project does not offer X as a target platform', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'x-hidden-project' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/projects/new`);

    const youtube = byTest(page, 'platform-youtube');

    await expect(youtube).toBeVisible();
    await expect(byTest(page, 'platform-twitter')).toHaveCount(0);
    await youtube.scrollIntoViewIfNeeded();
    await capture(page, '03-new-project-targets');
  });

  test('the analytics platform filter offers four platforms, not X', async ({
    page,
  }) => {
    const team = await teamWithKeptX('x-hidden-analytics');
    const project = await seedProject(team);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);

    const trigger = byTest(page, 'platform-filter-trigger');

    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const options = byTest(page, 'platform-filter-options');

    await expect(options).toBeVisible();
    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
      await expect(
        byTest(options, `platform-filter-${platform}`),
      ).toBeVisible();
    }
    await expect(byTest(options, 'platform-filter-twitter')).toHaveCount(0);
    await capture(page, '04-analytics-filter');
  });
});
