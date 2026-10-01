import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  episodeVideoUrl,
  insertRow,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1729. A platform the publish refuses says why, in the dialog, where
 * the person can read it. Before this, a failed platform's reason lived in a
 * hover tooltip, and when every platform failed the dialog dropped the rows
 * altogether and showed only "All 1 platform(s) failed to publish." — so a
 * refusal returned as a value (such as X's reconnect text) reached nobody.
 *
 * The refusal here is the cheapest real one the publish screen can produce:
 * a declared YouTube channel whose stored token is not a ciphertext the app
 * can read, so the upload stops at the token step and reaches no vendor.
 * Run against a production build, where thrown action text is redacted
 * (KB-6): the reason shown must be the one returned as a value.
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
  await page.screenshot({ path: `${OUT}/film-1729-${name}.png` });

  // KB-157: the same screen in both themes, without reloading the dialog away
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(value);
      root.style.colorScheme = value;
    }, theme);
    await page.screenshot({ path: `${OUT}/kb-157-${name}-${theme}.png` });
  }
}

/** What the person reads (KB-157); the code stays on the element for support. */
const EXPIRED =
  'Your YouTube connection has expired. Reconnect YouTube in Settings → Platforms to publish.';
const STOPPED =
  'Your YouTube connection has stopped working. Reconnect YouTube in Settings → Platforms to publish.';

test.describe('A refused platform says why, inline (FILM-1729)', () => {
  test('after a failed publish, and again after a second one', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'f1729' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      localized_videos: { en: episodeVideoUrl(episodeId) },
    });

    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Harbor Lights',
      {
        platformAccountId: `UC-f1729-${randomUUID()}`,
        accessTokenEncrypted: 'f1729-not-a-real-token',
      },
    );

    // Declared, so the audience question (KB-30) does not stand in the way.
    await updateRows('platform_connections', `id=eq.${connectionId}`, {
      youtube_made_for_kids: false,
      youtube_category_id: '22',
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    // Rendered once connections load: a click before then finds no channels.
    await expect(
      page.getByRole('button', { name: 'Manage Channels' }),
    ).toBeVisible();

    const publish = async () => {
      await byTest(page, 'publish-all').click();
      await byTest(page, 'confirm-publish').click();

      const row = page.locator(
        '[data-test="publish-platform-status"][data-platform="youtube"]',
      );

      await expect(row).toHaveAttribute('data-status', 'error', {
        timeout: 60_000,
      });

      return row;
    };

    const first = await publish();
    const reason = byTest(first, 'publish-platform-error');

    // The token check's own reason: the stored token cannot be refreshed,
    // worded for the person, with the code kept for support (KB-157).
    await expect(reason).toHaveText(EXPIRED);
    await expect(reason).toHaveAttribute('data-error-code', 'NO_REFRESH_TOKEN');
    await capture(page, '01-refused-inline');

    // Second submission, from the state the first left behind. That failure
    // deactivated the connection, so the reason is now a different one: the
    // row shows this attempt's reason, not the first one left on screen.
    await byTest(page, 'publish-dialog-close').click();
    await expect(first).toBeHidden();

    const second = await publish();

    const secondReason = byTest(second, 'publish-platform-error');

    await expect(secondReason).toHaveText(STOPPED);
    await expect(secondReason).toHaveAttribute(
      'data-error-code',
      'CONNECTION_INACTIVE',
    );
    await capture(page, '02-refused-again');
  });

  test('a failure stored as a bare code reads as a sentence in Published Content (KB-157)', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb157' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'KB-157 channel',
      { platformAccountId: `UC-kb157-${randomUUID()}` },
    );

    // What the scheduled-publish job and the publish worker stored for a
    // token refusal before KB-157: the bare code, as the failure's text.
    await insertRow(
      'publishes',
      {
        episode_id: episodeId,
        platform_connection_id: connectionId,
        platform: 'youtube',
        status: 'failed',
        title: 'KB-157 video',
        metadata: { error: 'NO_REFRESH_TOKEN' },
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const recorded = byTest(page, 'published-content-error');

    await expect(recorded).toHaveText(EXPIRED);
    await expect(recorded).toHaveAttribute(
      'data-error-code',
      'NO_REFRESH_TOKEN',
    );
    await recorded.scrollIntoViewIfNeeded();
    await capture(page, '03-published-content-record');
  });
});
