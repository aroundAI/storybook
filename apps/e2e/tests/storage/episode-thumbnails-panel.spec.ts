import { type Locator, type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  deleteRows,
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  storageObjectExists,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { png } from './png';

/**
 * KB-89: an episode's thumbnails could not be removed in the app — the panel
 * that manages them (add per language, set default, remove) was rendered
 * nowhere. It now sits on the publish screen, over the same list the
 * per-language video slots read, so the two never disagree.
 *
 * KB-61: removing a thumbnail deleted the file first and then the row, and a
 * member's row delete matched nothing under the table's policy — so the app
 * said "Deleted" while the row stayed, pointing at a file that was gone.
 * Members may remove thumbnails (owner decision 2026-09-25), the row goes
 * first, and a remove that removed nothing says so in words.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase).
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const RED: [number, number, number] = [200, 40, 40];
const GREEN: [number, number, number] = [40, 160, 80];
const BLUE: [number, number, number] = [40, 90, 220];

let team: SeededTeam;
let project: SeededProject;

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb89-owner' });
  project = await seedProject(team, { name: 'KB-89 thumbnails' });
});

function keyOf(url: string) {
  const marker = '/project-assets/';
  return decodeURI(url.slice(url.indexOf(marker) + marker.length)).split(
    '?',
  )[0]!;
}

async function seedEpisode() {
  const episode = await seedEpisodeWithShot(project.id);
  // The publish screen shows a video slot, with its thumbnail, per language
  // that has a video.
  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    localized_videos: {
      en: 'https://example.invalid/en.mp4',
      hi: 'https://example.invalid/hi.mp4',
    },
  });

  return episode;
}

async function thumbnailRows(episodeId: string) {
  return readRows<{ id: string; language: string; thumbnail_url: string }>(
    'episode_thumbnails',
    `episode_id=eq.${episodeId}&select=id,language,thumbnail_url,is_default&order=language`,
  );
}

async function openPublish(page: Page, slug: string) {
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  );

  // Exactly one panel: while a navigation settles the screen can briefly
  // render twice (see intro-thumbnail-upload.spec.ts), so wait for one.
  const panel = byTest(page, 'episode-thumbnails');
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeVisible();
  await expect(byTest(panel, 'thumbnails-loading')).toHaveCount(0);

  return panel;
}

async function addThumbnail(
  page: Page,
  panel: Locator,
  language: string,
  colour: [number, number, number],
) {
  await byTest(panel, 'thumbnail-add').click();

  const dialog = page.getByRole('dialog');
  await byTest(dialog, 'thumbnail-language').fill(language);

  // A file chosen before hydration is ignored; the preview shows the handler ran.
  await expect(async () => {
    await dialog.locator('[data-test="thumbnail-file"]').setInputFiles({
      name: `${language}.png`,
      mimeType: 'image/png',
      buffer: png(colour),
    });
    await expect(dialog.getByAltText('Thumbnail preview')).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  await byTest(dialog, 'thumbnail-submit').click();
  await expect(byTest(panel, `thumbnail-${language}`)).toBeVisible({
    timeout: 30_000,
  });
}

async function removeThumbnail(page: Page, panel: Locator, language: string) {
  await byTest(panel, `thumbnail-remove-${language}`).click();
  await byTest(page, 'thumbnail-remove-confirm').click();
}

/** The image the publish screen's video slot shows for a language */
async function slotImage(page: Page, language: string) {
  const image = page
    .locator(`label[for="thumbnail-input-full-${language}"] img`)
    .first();

  if ((await image.count()) === 0) return null;

  const src = await image.getAttribute('src');
  return src ? decodeURIComponent(src) : null;
}

test.describe('Episode thumbnails panel (KB-89, KB-61)', () => {
  test('add two, set a default, remove both; the video slots agree throughout', async ({
    page,
  }) => {
    const episode = await seedEpisode();

    await signInAs(page, team);
    const panel = await openPublish(page, episode.slug);

    await expect(byTest(panel, 'thumbnails-empty')).toBeVisible();

    await addThumbnail(page, panel, 'en', RED);
    await addThumbnail(page, panel, 'hi', GREEN);

    const [en, hi] = await thumbnailRows(episode.episodeId);
    expect(en!.language).toBe('en');
    expect(hi!.language).toBe('hi');

    // The slot reads the same list the panel writes
    await expect
      .poll(() => slotImage(page, 'en'))
      .toContain(keyOf(en!.thumbnail_url));
    await expect
      .poll(() => slotImage(page, 'hi'))
      .toContain(keyOf(hi!.thumbnail_url));

    // Hindi becomes the default: a language with no thumbnail of its own
    // falls back to it, in the slot as in the publish step.
    await byTest(panel, 'thumbnail-set-default-hi').click();
    await expect(
      panel.locator(
        '[data-test="thumbnail-hi"] [data-test="thumbnail-default"]',
      ),
    ).toBeVisible();

    if (evidence) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/kb89-01-two-thumbnails.png` });
    }

    // Cancel leaves it
    await byTest(panel, 'thumbnail-remove-en').click();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb89-02-confirm-remove.png` });
    }

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(byTest(panel, 'thumbnail-en')).toBeVisible();
    expect(await thumbnailRows(episode.episodeId)).toHaveLength(2);

    // Remove English: the row and its file go, and its slot now shows the
    // default (Hindi) rather than the removed image
    await removeThumbnail(page, panel, 'en');
    await expect(byTest(panel, 'thumbnail-en')).toHaveCount(0);
    await expect
      .poll(async () => (await thumbnailRows(episode.episodeId)).length)
      .toBe(1);
    expect(
      await storageObjectExists('project-assets', keyOf(en!.thumbnail_url)),
    ).toBe(false);
    expect(
      await storageObjectExists('project-assets', keyOf(hi!.thumbnail_url)),
    ).toBe(true);
    await expect
      .poll(() => slotImage(page, 'en'))
      .toContain(keyOf(hi!.thumbnail_url));

    if (evidence) {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/kb89-03-after-remove.png` });
    }

    // After a reload it is still gone
    await page.reload();
    const reloaded = await openPublish(page, episode.slug);
    await expect(byTest(reloaded, 'thumbnail-en')).toHaveCount(0);
    await expect(byTest(reloaded, 'thumbnail-hi')).toBeVisible();

    if (evidence) {
      await reloaded.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/kb89-04-after-reload.png` });
    }

    // The second removal, after the first
    await removeThumbnail(page, reloaded, 'hi');
    await expect(byTest(reloaded, 'thumbnails-empty')).toBeVisible();
    await expect
      .poll(async () => (await thumbnailRows(episode.episodeId)).length)
      .toBe(0);
    expect(
      await storageObjectExists('project-assets', keyOf(hi!.thumbnail_url)),
    ).toBe(false);
    await expect.poll(() => slotImage(page, 'hi')).toBeNull();
  });

  test('a project member removes a thumbnail, and its file goes with it', async ({
    page,
  }) => {
    const episode = await seedEpisode();
    const member = await seedUser('kb89-member');
    await seedMembership(member.userId, team.accountId);
    await seedProjectMember(project.id, member.userId, 'member');

    await signInAs(page, member);
    const panel = await openPublish(page, episode.slug);

    await addThumbnail(page, panel, 'en', BLUE);
    const [row] = await thumbnailRows(episode.episodeId);

    await removeThumbnail(page, panel, 'en');

    await expect(byTest(panel, 'thumbnail-en')).toHaveCount(0);
    await expect
      .poll(async () => (await thumbnailRows(episode.episodeId)).length)
      .toBe(0);
    expect(
      await storageObjectExists('project-assets', keyOf(row!.thumbnail_url)),
    ).toBe(false);

    await page.reload();
    const reloaded = await openPublish(page, episode.slug);
    await expect(byTest(reloaded, 'thumbnails-empty')).toBeVisible();
  });

  test('removing a thumbnail that is already gone says so, and keeps nothing stale', async ({
    page,
  }) => {
    const episode = await seedEpisode();

    await signInAs(page, team);
    const panel = await openPublish(page, episode.slug);
    await addThumbnail(page, panel, 'en', RED);

    // Another tab removes it first
    await deleteRows(
      'episode_thumbnails',
      `episode_id=eq.${episode.episodeId}`,
    );

    await removeThumbnail(page, panel, 'en');

    await expect(
      page.getByText(
        "The thumbnail wasn't removed: it's already gone, or you can't remove it. Reload the page.",
      ),
    ).toBeVisible();

    // The refusal re-reads the list: the card for a row that is gone goes
    await expect(byTest(panel, 'thumbnail-en')).toHaveCount(0);
    await expect(byTest(panel, 'thumbnails-empty')).toBeVisible();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb89-05-already-gone.png` });
    }
  });
});
