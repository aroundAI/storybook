import { type Locator, type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type SeededProject,
  type SeededTeam,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  storageObjectExists,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { png } from './png';

/**
 * KB-39: the project intro dialog built `projects/<P>/intros/…`, a path the
 * presign route refuses, so no intro ever uploaded. It now builds
 * `projects/<P>/assets/intros/…` through the shared path builder.
 *
 * KB-54: replacing or deleting an intro, or replacing an episode thumbnail,
 * computed the old file's key with `slice(-2)` and deleted nothing. The old
 * file must now be gone after a replace and after a delete.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase). The
 * fixtures are 1.2 s WebM clips: see fixtures/generate-intro-videos.mjs for
 * why not MP4.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const INTRO_A = readFileSync(join(__dirname, 'fixtures', 'intro-a.webm'));
const INTRO_B = readFileSync(join(__dirname, 'fixtures', 'intro-b.webm'));

const RED: [number, number, number] = [200, 40, 40];
const BLUE: [number, number, number] = [40, 90, 220];

let team: SeededTeam;
let project: SeededProject;

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb39-owner' });
  project = await seedProject(team, { name: 'KB-39 intros' });
});

/** The object key behind a stored public URL, read with the bucket name */
function keyOf(url: string) {
  const marker = '/project-assets/';
  return decodeURI(url.slice(url.indexOf(marker) + marker.length)).split(
    '?',
  )[0]!;
}

async function introRow(language: string) {
  const [row] = await readRows<{ video_url: string }>(
    'project_intros',
    `project_id=eq.${project.id}&language=eq.${language}&select=video_url`,
  );

  return row ?? null;
}

async function chooseVideo(
  dialog: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  // A file chosen before hydration is ignored; the "Selected:" line shows
  // the handler ran.
  await expect(async () => {
    await dialog.locator('[data-test="intro-file"]').setInputFiles(file);
    await expect(dialog.getByText(`Selected: ${file.name}`)).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

async function openSettings(page: Page) {
  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/settings`);
  await expect(page.getByText('Episode Intros')).toBeVisible();
}

test.describe('Project intros (KB-39, KB-54)', () => {
  test('add, replace and delete an intro; the old file goes each time', async ({
    page,
  }) => {
    await openSettings(page);

    // Add
    await byTest(page, 'intro-add').click();
    let dialog = page.getByRole('dialog');
    await byTest(dialog, 'intro-language').fill('en');
    await chooseVideo(dialog, {
      name: 'intro-a.webm',
      mimeType: 'video/webm',
      buffer: INTRO_A,
    });

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb39-01-intro-dialog.png` });
    }

    await byTest(dialog, 'intro-submit').click();

    await expect(page.getByText('Added en intro').first()).toBeVisible();
    const card = page.locator('[data-test="intro-card"][data-language="en"]');
    await expect(card).toBeVisible();

    const added = await introRow('en');
    expect(added?.video_url).toMatch(
      new RegExp(
        `/project-assets/projects/${project.id}/assets/intros/en-\\d+\\.webm$`,
      ),
    );
    const firstKey = keyOf(added!.video_url);
    expect(await storageObjectExists('project-assets', firstKey)).toBe(true);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb39-02-intro-added.png` });
    }

    // Replace: a new file, and the first one is deleted
    await byTest(card, 'intro-replace').click();
    dialog = page.getByRole('dialog');
    await chooseVideo(dialog, {
      name: 'intro-b.webm',
      mimeType: 'video/webm',
      buffer: INTRO_B,
    });
    await byTest(dialog, 'intro-submit').click();

    await expect(page.getByText('Replaced en intro').first()).toBeVisible();
    await expect(card).toContainText('intro-b.webm');

    const replaced = await introRow('en');
    expect(replaced?.video_url).not.toBe(added?.video_url);
    const secondKey = keyOf(replaced!.video_url);
    expect(await storageObjectExists('project-assets', secondKey)).toBe(true);
    expect(await storageObjectExists('project-assets', firstKey)).toBe(false);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb54-01-intro-replaced.png` });
    }

    // Delete: the row and the file
    await byTest(card, 'intro-delete').click();

    await expect(page.getByText('Deleted en intro').first()).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(await introRow('en')).toBeNull();
    expect(await storageObjectExists('project-assets', secondKey)).toBe(false);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb54-02-intro-deleted.png` });
    }
  });

  test('a video type the route refuses is named in the error', async ({
    page,
  }) => {
    await openSettings(page);

    await byTest(page, 'intro-add').click();
    const dialog = page.getByRole('dialog');
    await byTest(dialog, 'intro-language').fill('fr');
    await chooseVideo(dialog, {
      name: 'intro.mkv',
      mimeType: 'video/x-matroska',
      buffer: INTRO_A,
    });
    await byTest(dialog, 'intro-submit').click();

    await expect(
      page.getByText('Content type not allowed: video/x-matroska').first(),
    ).toBeVisible();
    expect(await introRow('fr')).toBeNull();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb39-03-intro-refused-type.png` });
    }
  });
});

test.describe('Episode thumbnails (KB-54)', () => {
  test('replacing a thumbnail deletes the old file', async ({ page }) => {
    const episode = await seedEpisodeWithShot(project.id);
    // The publish screen shows a thumbnail slot per language with a video.
    await updateRows('episodes', `id=eq.${episode.episodeId}`, {
      localized_videos: { en: 'https://example.invalid/en.mp4' },
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/publish`,
    );

    // The screen can render a language's card twice (same input id).
    const input = page.locator('#thumbnail-input-full-en').first();
    await expect(input).toBeAttached();

    const thumbnailUrl = async () => {
      const [row] = await readRows<{ thumbnail_url: string }>(
        'episode_thumbnails',
        `episode_id=eq.${episode.episodeId}&language=eq.en&select=thumbnail_url`,
      );
      return row?.thumbnail_url ?? null;
    };

    const upload = async (buffer: Buffer, previous: string | null) => {
      await expect(async () => {
        await input.setInputFiles({
          name: 'thumb.png',
          mimeType: 'image/png',
          buffer,
        });
        await expect.poll(thumbnailUrl, { timeout: 5_000 }).not.toBe(previous);
      }).toPass({ timeout: 30_000 });

      return (await thumbnailUrl())!;
    };

    const first = await upload(png(RED), null);
    const firstKey = keyOf(first);
    expect(firstKey).toMatch(
      new RegExp(`^episodes/${episode.episodeId}/thumbnails/en-\\d+\\.png$`),
    );
    expect(await storageObjectExists('project-assets', firstKey)).toBe(true);

    const second = await upload(png(BLUE), first);
    const secondKey = keyOf(second);

    expect(await storageObjectExists('project-assets', secondKey)).toBe(true);
    expect(await storageObjectExists('project-assets', firstKey)).toBe(false);

    if (evidence) {
      await page
        .locator('label[for="thumbnail-input-full-en"]')
        .first()
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/kb54-03-thumbnail-replaced.png` });
    }
  });
});
