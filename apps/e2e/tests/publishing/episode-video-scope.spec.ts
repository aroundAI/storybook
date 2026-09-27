import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-123. An episode's video URL decides which file a publish sends to the
 * channel, and the save took any URL. It must now be one of the episode's
 * own uploads.
 *
 * The screen only ever sends the URL of a file it just uploaded to the
 * episode's own folder, so the refusal cannot be reached by clicking. The
 * request is rewritten on its way out, as a caller of the action could, to
 * name another episode's file.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const REFUSAL =
  "That video isn't one of this episode's uploads. Upload it from the episode's publish screen.";

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/kb-123-${name}.png` });
}

async function storedVideos(episodeId: string) {
  const [row] = await readRows<{
    localized_videos: Record<string, string> | null;
  }>('episodes', `id=eq.${episodeId}&select=localized_videos`);

  return row?.localized_videos ?? {};
}

test.describe('An episode video is one of its own uploads (KB-123)', () => {
  test('another episode’s file is refused and nothing saved; the upload itself then saves', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb123' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);
    const foreignEpisode = randomUUID();

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const ownFolder = `/episodes/${episodeId}/videos/`;

    await page.route('**/*', async (route) => {
      const request = route.request();
      const body = request.postData();

      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        body?.includes(ownFolder)
      ) {
        return route.continue({
          postData: body.replaceAll(
            ownFolder,
            `/episodes/${foreignEpisode}/videos/`,
          ),
        });
      }

      return route.continue();
    });

    await page.locator('[data-test="upload-full-video"]').click();
    await page.locator('[data-test="upload-video-file"]').setInputFiles({
      name: 'pilot.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('kb-123 stand-in video'),
    });
    await page.locator('[data-test="upload-video-submit"]').click();

    await expect(page.getByText(REFUSAL)).toBeVisible();
    await capture(page, '01-refused');
    expect(await storedVideos(episodeId)).toEqual({});

    // The second submission, on the same open dialog, unaltered
    await page.unrouteAll({ behavior: 'wait' });
    await page.locator('[data-test="upload-video-submit"]').click();

    await expect(page.getByText('Video uploaded for English')).toBeVisible();
    await capture(page, '02-saved');

    const saved = await storedVideos(episodeId);
    expect(Object.keys(saved)).toEqual(['en']);
    expect(saved.en).toContain(ownFolder);
  });
});
