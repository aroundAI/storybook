import { type Page, type Route, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  readRows,
  seedProject,
  seedTeamAccount,
  seedUser,
  storageObjectExists,
  storageObjectsUnder,
  storageUploadAs,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-55 / KB-56: the audio buckets exist and the reports bucket admits a
 * personal account's owner.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase), which is
 * where these failed: every audio upload ended in "Bucket not found", and the
 * audio library could not even build its storage adapter.
 *
 * KB-73 / KB-79: the library now uploads straight to `project-assets` through
 * the presign route and records the key with a small action; the R2 key
 * layout and that action's checks are asserted in
 * apps/web/app/api/storage/__tests__/audio-asset-upload.test.ts.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

/** An MPEG frame header; the Storage API checks the declared type, not bytes. */
const mp3 = (bytes: number) =>
  Buffer.concat([
    Buffer.from('ID3'),
    Buffer.from([0x03, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(bytes - 10, 0xff),
  ]);

const MP3 = mp3(522);

/**
 * Upload one file through the real dialog, opened from the library header.
 * `expectClosed` is false when the upload is meant to be refused.
 */
async function uploadThroughDialog(
  page: Page,
  track: { name: string; file: string; bytes: Buffer },
  expectClosed = true,
  screenshot?: string,
) {
  // Visible only (KB-136): React can leave a streamed copy of the page in a
  // hidden container, so a strict locator also matches a card nobody sees.
  await page
    .locator('[data-test="audio-library-upload"]')
    .filter({ visible: true })
    .click();

  const submit = page.locator('[data-test="audio-upload-submit"]');

  // As in the KB-28 spec: on a production build the file input can be
  // live before React attaches onChange. Choosing again is harmless until
  // the handler has run, which is what enables the submit button.
  await expect(async () => {
    await page.locator('[data-test="audio-upload-file"]').setInputFiles({
      name: track.file,
      mimeType: 'audio/mpeg',
      buffer: track.bytes,
    });
    await expect(submit).toBeEnabled({ timeout: 1_000 });
  }).toPass();

  await page.locator('[data-test="audio-upload-name"]').fill(track.name);

  if (evidence && screenshot) {
    await page.screenshot({ path: `${OUT}/${screenshot}` });
  }

  await submit.click();

  if (expectClosed) {
    await expect(submit).toBeHidden();
  }
}

let team: SeededTeam;
let project: SeededProject;
let personal: SeededUser;
let stranger: SeededUser;

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb55-owner' });
  project = await seedProject(team, { name: 'KB-55 audio' });
  personal = await seedUser('kb55-personal');
  stranger = await seedUser('kb55-stranger');
});

test.describe('Media and report storage (KB-55, KB-56)', () => {
  // KB-73 / KB-79: the first file is 2 MB, over the 1 MB server-action
  // limit the base64 upload hit; the second is uploaded straight after, with
  // no reload, because the library could take only one upload and showed a
  // new one only after a reload.
  test('the owner uploads two tracks in a row, one of 2 MB, and both show and play without a reload', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);

    const stamp = Date.now();
    const tracks = [
      {
        name: `Opening theme ${stamp}`,
        file: 'opening theme.mp3',
        bytes: mp3(2 * 1024 * 1024),
      },
      { name: `Door creak ${stamp}`, file: 'door creak.mp3', bytes: MP3 },
    ];

    for (const [index, track] of tracks.entries()) {
      await uploadThroughDialog(
        page,
        track,
        true,
        index === 0 ? 'kb73-00-dialog-2mb-file.png' : undefined,
      );

      // No reload: the card is drawn from what the save returned
      await expect(
        page
          .locator('[data-test="audio-asset-card"]', { hasText: track.name })
          .filter({ visible: true }),
      ).toBeVisible();

      if (evidence) {
        await page.screenshot({
          path: `${OUT}/kb73-0${index + 1}-library-after-upload-${index + 1}.png`,
        });
      }
    }

    for (const track of tracks) {
      const [asset] = await readRows<{
        file_url: string;
        file_path: string;
        file_size_bytes: number;
        status: string;
        source: string;
      }>(
        'audio_assets',
        `project_id=eq.${project.id}&name=eq.${encodeURIComponent(track.name)}&select=file_url,file_path,file_size_bytes,status,source`,
      );

      expect(asset, `the row for ${track.name}`).toBeTruthy();
      expect(asset!.status).toBe('completed');
      expect(asset!.source).toBe('uploaded');
      expect(asset!.file_size_bytes).toBe(track.bytes.length);
      expect(asset!.file_path).toMatch(
        new RegExp(
          `^projects/${project.id}/assets/audio/\\d+-[0-9a-f]{8}\\.mp3$`,
        ),
      );
      expect(asset!.file_url).toContain(
        `/object/public/project-assets/${asset!.file_path}`,
      );
      expect(
        await storageObjectExists('project-assets', asset!.file_path),
      ).toBe(true);

      const file = await page.request.get(asset!.file_url);
      expect(file.status()).toBe(200);
      expect(file.headers()['content-type']).toBe('audio/mpeg');
      expect(Number(file.headers()['content-length'])).toBe(track.bytes.length);
    }

    await page.reload();
    for (const track of tracks) {
      await expect(
        page.getByText(track.name).filter({ visible: true }),
      ).toBeVisible();
    }
  });

  // KB-57, audio leg: the old action stored a stranger's file with the admin
  // client, at a key naming no project, before the row was refused.
  test("a stranger's upload aimed at another account's project stores nothing", async ({
    page,
  }) => {
    // A writer on their own team's project, and no member of the victim's
    const outsider = await seedTeamAccount({ emailPrefix: 'kb73-outsider' });
    const own = await seedProject(outsider, { name: 'KB-73 outsider' });
    const presigned: number[] = [];
    // The victim's project is this test's alone. It shared the team's
    // project with the upload test above, so its "adds nothing" snapshot
    // depended on that test's files being listed first: 6 of 30 local-CI
    // runs saw its two tracks appear after the snapshot and retried.
    const victim = await seedProject(team, { name: 'KB-73 victim' });

    // Every request the dialog sends names the victim's project instead
    const retarget = async (route: Route) => {
      const body = (route.request().postData() ?? '')
        .split(own.id)
        .join(victim.id);
      const response = await route.fetch({ postData: body });
      if (route.request().url().includes('/api/storage/presign')) {
        presigned.push(response.status());
      }
      await route.fulfill({ response });
    };

    await page.route('**/api/storage/presign', retarget);
    await page.route('**/audio-library', (route) =>
      route.request().method() === 'POST' ? retarget(route) : route.continue(),
    );

    // The earlier test stores the owner's own tracks in this folder: what
    // matters is that the stranger's attempt adds nothing to it
    const folder = `projects/${victim.id}/assets/audio`;
    const before = await storageObjectsUnder('project-assets', folder);

    await signInAs(page, outsider);
    await page.goto(`/home/${outsider.slug}/studio/${own.slug}/audio-library`);

    const name = `Planted ${Date.now()}`;
    await uploadThroughDialog(
      page,
      { name, file: 'planted.mp3', bytes: MP3 },
      false,
    );

    await expect(
      page.locator('[data-test="audio-upload-error"]'),
    ).toContainText('You do not have permission to upload to this project');
    expect(presigned).toEqual([403]);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb73-03-outsider-refused.png` });
    }

    expect(await storageObjectsUnder('project-assets', folder)).toEqual(before);
    expect(
      await readRows(
        'audio_assets',
        `project_id=eq.${victim.id}&name=eq.${encodeURIComponent(name)}&select=id`,
      ),
    ).toEqual([]);
  });

  test('audio buckets: project writers only, audio types only', async () => {
    const sfx = `${project.id}/sfx/${Date.now()}.mp3`;

    const ownerWrite = await storageUploadAs(
      team,
      'audio',
      sfx,
      MP3,
      'audio/mpeg',
    );
    expect(ownerWrite.status, ownerWrite.body).toBe(200);

    const planted = `${project.id}/sfx/planted-${Date.now()}.mp3`;
    const strangerWrite = await storageUploadAs(
      stranger,
      'audio',
      planted,
      MP3,
      'audio/mpeg',
    );
    expect(strangerWrite.status, strangerWrite.body).not.toBe(200);
    expect(strangerWrite.body).toContain('row-level security');
    expect(await storageObjectExists('audio', planted)).toBe(false);

    const library = `music/${Date.now()}-planted.mp3`;
    const libraryWrite = await storageUploadAs(
      team,
      'audio-assets',
      library,
      MP3,
      'audio/mpeg',
    );
    expect(libraryWrite.status, libraryWrite.body).not.toBe(200);
    expect(await storageObjectExists('audio-assets', library)).toBe(false);

    const html = `${project.id}/sfx/${Date.now()}.html`;
    const htmlWrite = await storageUploadAs(
      team,
      'audio',
      html,
      '<script>alert(document.domain)</script>',
      'text/html',
    );
    expect(htmlWrite.status, htmlWrite.body).not.toBe(200);
    expect(await storageObjectExists('audio', html)).toBe(false);
  });

  test('reports: a personal account owner stores their own, nobody else can', async () => {
    const own = `exports/${personal.userId}/${Date.now()}-report.csv`;

    const personalWrite = await storageUploadAs(
      personal,
      'reports',
      own,
      'views\n1\n',
      'text/csv',
    );
    expect(personalWrite.status, personalWrite.body).toBe(200);

    const planted = `exports/${personal.userId}/${Date.now()}-planted.csv`;
    const strangerWrite = await storageUploadAs(
      stranger,
      'reports',
      planted,
      'views\n1\n',
      'text/csv',
    );
    expect(strangerWrite.status, strangerWrite.body).not.toBe(200);
    expect(await storageObjectExists('reports', planted)).toBe(false);

    const html = `exports/${personal.userId}/${Date.now()}-page.html`;
    const htmlWrite = await storageUploadAs(
      personal,
      'reports',
      html,
      '<script>alert(document.domain)</script>',
      'text/html',
    );
    expect(htmlWrite.status, htmlWrite.body).not.toBe(200);
    expect(await storageObjectExists('reports', html)).toBe(false);
  });
});
