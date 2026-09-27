import { type Page, type Request, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  type SeededTeam,
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-30. Every YouTube upload declared "not made for kids" and category 22 —
 * COPPA declarations nobody had made — and no screen showed or asked either.
 * Measured on `main` before the fix: Publish All went straight to the confirm
 * step, and the `publishToAllAction` request carried `"platformSpecific":{}`
 * for the YouTube channel, which every upload path turned into `false`/`22`.
 *
 * The owner's decision: the declaration belongs to the channel, and there is
 * no default — the first publish to a channel asks for the audience and the
 * category, with nothing pre-selected.
 *
 * Asserted on the request the browser sends, because that is what every
 * later path (immediate upload, the publish row's snapshot, retries, the
 * scheduled-publish worker) reads. The seeded token is not a real ciphertext,
 * so the upload itself fails at the token step and reaches no vendor.
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
  await page.screenshot({ path: `${OUT}/kb-30-${name}.png` });
}

interface Fixture {
  team: SeededTeam;
  connectionId: string;
  publishUrl: string;
}

async function seedUndeclaredChannel(page: Page): Promise<Fixture> {
  const team = await seedTeamAccount({ emailPrefix: 'kb30' });
  const project = await seedProject(team);
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);

  await updateRows('episodes', `id=eq.${episodeId}`, {
    localized_videos: { en: episodeVideoUrl(episodeId) },
  });

  const connectionId = await seedYouTubeConnection(
    team.accountId,
    'Acme Kids',
    {
      platformAccountId: `UC-kb30-${randomUUID()}`,
      accessTokenEncrypted: 'kb30-not-a-real-token',
    },
  );

  await signInAs(page, team);

  return {
    team,
    connectionId,
    publishUrl: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  };
}

async function channelDeclaration(connectionId: string) {
  const [row] = await readRows<{
    youtube_made_for_kids: boolean | null;
    youtube_category_id: string | null;
  }>(
    'platform_connections',
    `id=eq.${connectionId}&select=youtube_made_for_kids,youtube_category_id`,
  );

  return row;
}

function isPublishRequest(request: Request) {
  return (
    request.method() === 'POST' &&
    Boolean(request.headers()['next-action']) &&
    (request.postData() ?? '').includes('"platforms"')
  );
}

/** The YouTube config the browser sent to `publishToAllAction`. */
function youtubeConfigIn(request: Request, connectionId: string) {
  const [input] = JSON.parse(request.postData() ?? '[]') as Array<{
    platforms: Array<{
      platform: string;
      connectionId: string;
      platformSpecific: Record<string, unknown>;
    }>;
  }>;

  return input?.platforms.find(
    (config) =>
      config.platform === 'youtube' && config.connectionId === connectionId,
  );
}

/** Publish All → confirm → the request it sends. */
async function confirmAndCapture(page: Page) {
  await expect(page.locator('[data-test="confirm-publish"]')).toBeVisible();

  const [request] = await Promise.all([
    page.waitForRequest(isPublishRequest),
    page.locator('[data-test="confirm-publish"]').click(),
  ]);

  return request;
}

async function answer(
  page: Page,
  choice: 'made-for-kids' | 'not-for-kids',
  categoryId: string,
) {
  const dialog = page.locator('[data-test="youtube-audience-dialog"]');

  await dialog.locator(`[data-test="audience-${choice}"]`).click();
  await dialog.locator('[data-test="audience-category"]').click();
  await page.locator(`[data-test="audience-category-${categoryId}"]`).click();

  return dialog;
}

test.describe('YouTube uploads declare the audience the creator chose (KB-30)', () => {
  test('the first publish asks, sends the answer, and the answer is the channel’s from then on', async ({
    page,
  }) => {
    const fixture = await seedUndeclaredChannel(page);

    await page.goto(fixture.publishUrl);
    await expect(
      page.locator('[data-test="youtube-audience-not-set"]'),
    ).toContainText('Acme Kids');
    await capture(page, '01-sidebar-not-set');

    // Asked before anything else happens, with nothing pre-selected.
    await page.locator('[data-test="publish-all"]').click();

    const dialog = page.locator('[data-test="youtube-audience-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('[data-test="audience-made-for-kids"]'),
    ).toHaveAttribute('data-state', 'unchecked');
    await expect(
      dialog.locator('[data-test="audience-not-for-kids"]'),
    ).toHaveAttribute('data-state', 'unchecked');
    await expect(
      dialog.locator('[data-test="audience-category"]'),
    ).toContainText('Choose a category');
    await expect(
      dialog.locator('[data-test="audience-continue"]'),
    ).toBeDisabled();
    await capture(page, '02-dialog-empty');

    // One answer is not enough: both are required.
    await dialog.locator('[data-test="audience-made-for-kids"]').click();
    await expect(
      dialog.locator('[data-test="audience-continue"]'),
    ).toBeDisabled();

    await answer(page, 'made-for-kids', '1');
    await expect(
      dialog.locator('[data-test="audience-continue"]'),
    ).toBeEnabled();
    await capture(page, '03-dialog-answered');

    await dialog.locator('[data-test="audience-continue"]').click();
    await expect(dialog).toBeHidden();

    // Saved to the channel, not just to this publish.
    await expect
      .poll(() => channelDeclaration(fixture.connectionId))
      .toEqual({ youtube_made_for_kids: true, youtube_category_id: '1' });

    // The confirm step says what YouTube will be told.
    await expect(
      page.locator(
        `[data-test="confirm-youtube-audience-row"][data-connection-id="${fixture.connectionId}"]`,
      ),
    ).toHaveText('Acme Kids: Made for kids · Film & Animation');
    await capture(page, '04-confirm-step');

    const first = await confirmAndCapture(page);
    expect(
      youtubeConfigIn(first, fixture.connectionId)?.platformSpecific,
    ).toEqual({
      madeForKids: true,
      categoryId: '1',
    });

    // The second submission: no question, the same declaration.
    // Wait for this upload to finish (it fails at the seeded token) before
    // closing: closing mid-upload lets the finishing upload reopen the dialog.
    await page.locator('[data-test="publish-dialog-close"]').click();
    await expect(page.locator('[data-test="confirm-publish"]')).toBeHidden();
    await page.locator('[data-test="publish-all"]').click();
    await expect(dialog).toBeHidden();

    const second = await confirmAndCapture(page);
    expect(
      youtubeConfigIn(second, fixture.connectionId)?.platformSpecific,
    ).toEqual({
      madeForKids: true,
      categoryId: '1',
    });

    // Changed in Settings → Platforms, the next publish sends the change.
    await page.goto(`/home/${fixture.team.slug}/settings/platforms`);

    const row = page.locator(
      `[data-test="connection-row"][data-connection-id="${fixture.connectionId}"]`,
    );
    await expect(
      row.locator('[data-test="youtube-audience-summary"]'),
    ).toHaveText('Made for kids · Film & Animation');

    await row.locator('[data-test="youtube-audience-edit"]').click();
    await expect(
      dialog.locator('[data-test="audience-made-for-kids"]'),
    ).toHaveAttribute('data-state', 'checked');
    await answer(page, 'not-for-kids', '27');
    await dialog.locator('[data-test="audience-continue"]').click();

    await expect(
      row.locator('[data-test="youtube-audience-summary"]'),
    ).toHaveText('Not made for kids · Education');
    await capture(page, '05-settings-row-changed');
    await expect
      .poll(() => channelDeclaration(fixture.connectionId))
      .toEqual({ youtube_made_for_kids: false, youtube_category_id: '27' });

    await page.goto(fixture.publishUrl);
    // Rendered once connections load: hydrated, so "not set" is really absent.
    await expect(
      page.getByRole('button', { name: 'Manage Channels' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-test="youtube-audience-not-set"]'),
    ).toBeHidden();
    await page.locator('[data-test="publish-all"]').click();
    await expect(
      page.locator('[data-test="confirm-youtube-audience-row"]'),
    ).toHaveText('Acme Kids: Not made for kids · Education');

    const third = await confirmAndCapture(page);
    expect(
      youtubeConfigIn(third, fixture.connectionId)?.platformSpecific,
    ).toEqual({
      madeForKids: false,
      categoryId: '27',
    });
  });

  test('cancelling the question publishes nothing and declares nothing', async ({
    page,
  }) => {
    const fixture = await seedUndeclaredChannel(page);
    const sent: Request[] = [];

    page.on('request', (request) => {
      if (isPublishRequest(request)) sent.push(request);
    });

    await page.goto(fixture.publishUrl);
    // Rendered by the client once connections load: the page is hydrated.
    await expect(
      page.locator('[data-test="youtube-audience-not-set"]'),
    ).toBeVisible();
    await page.locator('[data-test="publish-all"]').click();

    const dialog = page.locator('[data-test="youtube-audience-dialog"]');
    await expect(dialog).toBeVisible();

    await dialog.locator('[data-test="audience-cancel"]').click();
    await expect(dialog).toBeHidden();

    // Nothing went on to translation or confirmation either.
    await expect(page.locator('[data-test="confirm-publish"]')).toBeHidden();
    expect(sent).toEqual([]);
    expect(await channelDeclaration(fixture.connectionId)).toEqual({
      youtube_made_for_kids: null,
      youtube_category_id: null,
    });
  });
});
