import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-717. LinkedIn is retired "for now" (owner, 2026-10-02): nothing offers
 * it, and a team's existing LinkedIn rows are kept, shown as retired and
 * read-only. No vendor is involved: every path here refuses before one would
 * be called, so this runs against any server.
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

const OFFERED = ['youtube', 'tiktok', 'instagram', 'facebook', 'twitter'];

function card(page: Page, platform: string) {
  return byTest(page, `platform-card-${platform}`);
}

test.describe('LinkedIn is retired (FILM-717)', () => {
  test('Platform Connections offers no LinkedIn to a team that never connected it', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-none' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    for (const platform of OFFERED) {
      await expect(card(page, platform)).toBeVisible();
    }
    await expect(card(page, 'linkedin')).toHaveCount(0);
    await expect(byTest(page, 'connect-platform-linkedin')).toHaveCount(0);
    await capture(page, '01-platforms-without-linkedin');
  });

  test('a kept LinkedIn connection is retired and read-only, and can still be disconnected', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-kept' });
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Acme on LinkedIn',
      {
        platform: 'linkedin',
        accessTokenEncrypted: 'film717-not-a-real-token',
      },
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/platforms`);

    const linkedin = card(page, 'linkedin');
    const row = visible(
      linkedin,
      `[data-test="connection-row"][data-connection-id="${connectionId}"]`,
    );

    await expect(linkedin).toHaveAttribute('data-retired', 'true');
    await expect(byTest(linkedin, 'platform-retired-linkedin')).toHaveText(
      'Retired',
    );
    await expect(
      byTest(linkedin, 'platform-retired-note-linkedin'),
    ).toContainText('LinkedIn is retired: this app no longer connects');
    await expect(row).toContainText('Acme on LinkedIn');

    // Read-only: nothing that connects, renews or re-targets it.
    await expect(byTest(page, 'connect-platform-linkedin')).toHaveCount(0);
    await expect(byTest(row, 'refresh-connection')).toHaveCount(0);
    await expect(byTest(row, 'connection-language')).toHaveCount(0);
    await expect(byTest(row, 'reconnect-expired')).toHaveCount(0);
    await capture(page, '02-linkedin-retired-card');

    await byTest(row, 'disconnect-connection').click();

    const dialog = byTest(page, 'disconnect-dialog');

    await expect(byTest(dialog, 'disconnect-access')).toContainText(
      'LinkedIn is retired, so nothing is published to it or collected from it either way.',
    );
    await expect(byTest(dialog, 'disconnect-access')).not.toContainText(
      'until you reconnect',
    );
    await expect(byTest(dialog, 'disconnect-kept')).not.toContainText(
      'Reconnect',
    );
    await capture(page, '03-linkedin-retired-dialog');

    await byTest(dialog, 'confirm-disconnect').click();
    await expect(row).toHaveAttribute('data-status', 'disconnected');
    await expect(byTest(row, 'reconnect-connection')).toHaveCount(0);
    await capture(page, '04-linkedin-disconnected');

    // The row is kept; only the token we held is gone.
    const [stored] = await readRows<{
      disconnected_at: string | null;
      access_token_encrypted: string | null;
    }>(
      'platform_connections',
      `id=eq.${connectionId}&select=disconnected_at,access_token_encrypted`,
    );

    expect(stored?.disconnected_at).not.toBeNull();
    expect(stored?.access_token_encrypted).toBeNull();
  });

  test('an old LinkedIn connect link, or a late callback, says LinkedIn is retired', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film717-link' });

    await signInAs(page, team);

    for (const path of [
      `/api/platforms/connect/linkedin?account=${team.slug}`,
      '/api/platforms/callback/linkedin?code=late-code&state=late-state',
    ]) {
      await page.goto(path);

      const failure = byTest(page, 'connect-failure');

      await expect(failure).toHaveAttribute('data-code', 'platform_retired');
      expect(new URL(page.url()).pathname).toBe(
        `/home/${team.slug}/settings/platforms`,
      );
      await expect(byTest(failure, 'connect-failure-message')).toHaveText(
        'LinkedIn is retired: this app no longer connects or publishes to it. Nothing was connected.',
      );
    }

    await expect(card(page, 'linkedin')).toHaveCount(0);
    await capture(page, '05-connect-link-retired');
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
    await seedYouTubeConnection(team.accountId, 'Acme TV');
    await seedYouTubeConnection(team.accountId, 'Acme on LinkedIn', {
      platform: 'linkedin',
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    await expect(
      visible(page, '[data-test="channel-badge"][data-platform="youtube"]'),
    ).not.toHaveCount(0);
    await expect(
      visible(page, '[data-test="channel-badge"][data-platform="linkedin"]'),
    ).toHaveCount(0);
    await expect(page.getByText('Acme on LinkedIn')).toHaveCount(0);
    await visible(page, '[data-test="channel-badge"][data-platform="youtube"]')
      .first()
      .scrollIntoViewIfNeeded();
    await capture(page, '06-publish-screen');
  });
});
