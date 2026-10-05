import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type SeededProject,
  type SeededTeam,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { png } from './png';

/**
 * KB-189: a browser upload is a presigned PUT the server never sees, so the
 * page hashes the file and reports it to /api/storage/checksum, which
 * records it in media_checksums for the edit package (FILM-2001).
 *
 * The real Visual Studio sidebar uploads a shot video (through
 * useVideoUpload) and a first frame (through uploadWithPresignedUrl). For
 * each, the row the route recorded must hold the SHA-256 and size of the
 * object storage now serves at the URL the shot names.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase). The
 * video is the 1.2 s WebM the intro spec uses: the uploader decodes a frame
 * for its thumbnail, which Playwright's Chromium cannot do from an MP4.
 */

const VIDEO = readFileSync(join(__dirname, 'fixtures', 'intro-a.webm'));
const FRAME = png([30, 120, 200]);

let team: SeededTeam;
let project: SeededProject;
let episode: { episodeId: string; slug: string };

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb189-upload' });
  project = await seedProject(team, { name: 'KB-189 checksums' });
  episode = await seedEpisodeWithShot(project.id);
});

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

/** `<bucket>/<key>` of a stored public URL. */
function storageKey(url: string) {
  const [, rest] = url.split('/storage/v1/object/public/');
  const [bucket, ...key] = rest!.split('/');
  return { bucket: bucket!, key: key.join('/') };
}

async function shot() {
  const [row] = await readRows<{
    video_url: string | null;
    first_frame_url: string | null;
  }>(
    'shots',
    `episode_id=eq.${episode.episodeId}&select=video_url,first_frame_url`,
  );
  return row!;
}

async function recorded(url: string) {
  const { bucket, key } = storageKey(url);
  const rows = await readRows<{ sha256: string; bytes: number }>(
    'media_checksums',
    `bucket=eq.${bucket}&object_key=eq.${encodeURIComponent(key)}&select=sha256,bytes`,
  );
  return rows[0] ?? null;
}

test.describe('Browser uploads record their SHA-256 (KB-189)', () => {
  test('a shot video and a first frame, uploaded from Visual Studio', async ({
    page,
  }) => {
    const checksumCalls: number[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('/api/storage/checksum')) {
        checksumCalls.push(response.status());
      }
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/visual-studio`,
    );

    await byTest(page, 'shot-card').first().click({ timeout: 60_000 });

    // The video: the dropzone opens a file chooser of its own making.
    const dropzone = byTest(page, 'shot-video-dropzone');
    await expect(async () => {
      const chooser = page.waitForEvent('filechooser', { timeout: 3_000 });
      await dropzone.click();
      await (
        await chooser
      ).setFiles({ name: 'take.webm', mimeType: 'video/webm', buffer: VIDEO });
    }).toPass({ timeout: 30_000 });

    await expect
      .poll(async () => (await shot()).video_url, { timeout: 60_000 })
      .toMatch(/\/video\/\d+-take\.webm$/);

    const videoUrl = (await shot()).video_url!;
    const video = Buffer.from(await (await page.request.get(videoUrl)).body());

    expect(sha256(video)).toBe(sha256(VIDEO));
    await expect
      .poll(() => recorded(videoUrl), { timeout: 15_000 })
      .toEqual({ sha256: sha256(video), bytes: video.byteLength });

    // The first frame: a plain hidden input, through uploadWithPresignedUrl.
    const frameInput = page.locator('[data-test="frame-upload-input-first"]');
    await expect(async () => {
      await frameInput.setInputFiles({
        name: 'first.png',
        mimeType: 'image/png',
        buffer: FRAME,
      });
      await expect
        .poll(async () => (await shot()).first_frame_url, { timeout: 5_000 })
        .toMatch(/\/frames\/first-frame-\d+\.png$/);
    }).toPass({ timeout: 30_000 });

    const frameUrl = (await shot()).first_frame_url!;
    const frame = Buffer.from(await (await page.request.get(frameUrl)).body());

    expect(sha256(frame)).toBe(sha256(FRAME));
    await expect
      .poll(() => recorded(frameUrl), { timeout: 15_000 })
      .toEqual({ sha256: sha256(frame), bytes: frame.byteLength });

    // The video, its thumbnail and the frame, each recorded once
    expect(checksumCalls).toEqual([200, 200, 200]);
  });
});
