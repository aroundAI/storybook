import { expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  readRows,
  seedProject,
  seedTeamAccount,
  seedUser,
  storageObjectExists,
  storageUploadAs,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-55 / KB-56: the audio buckets exist and the reports bucket admits a
 * personal account's owner.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase), which is
 * where these failed: every audio upload ended in "Bucket not found", and the
 * audio library could not even build its storage adapter. The R2 key layout
 * is asserted in apps/web/app/api/storage/__tests__/audio-asset-upload.test.ts.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

/** An MPEG frame header; the Storage API checks the declared type, not bytes. */
const MP3 = Buffer.concat([
  Buffer.from('ID3'),
  Buffer.from([0x03, 0, 0, 0, 0, 0, 0]),
  Buffer.alloc(512, 0xff),
]);

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
  test('the owner uploads a track to the audio library, and it plays', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);

    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    const submit = page.locator('[data-test="audio-upload-submit"]');
    const name = `Opening theme ${Date.now()}`;

    // As in the KB-28 spec: on a production build the file input can be
    // live before React attaches onChange. Choosing again is harmless until
    // the handler has run, which is what enables the submit button.
    await expect(async () => {
      await page.locator('[data-test="audio-upload-file"]').setInputFiles({
        name: 'opening theme.mp3',
        mimeType: 'audio/mpeg',
        buffer: MP3,
      });
      await expect(submit).toBeEnabled({ timeout: 1_000 });
    }).toPass();

    await page.locator('[data-test="audio-upload-name"]').fill(name);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb55-01-upload-dialog.png` });
    }

    await submit.click();

    await expect(submit).toBeHidden();
    await expect(page.locator('[data-test="audio-upload-error"]')).toHaveCount(
      0,
    );

    const [asset] = await readRows<{
      file_url: string;
      file_path: string;
      status: string;
    }>(
      'audio_assets',
      `project_id=eq.${project.id}&name=eq.${encodeURIComponent(name)}&select=file_url,file_path,status`,
    );

    expect(asset, 'the asset row was written').toBeTruthy();
    expect(asset!.status).toBe('completed');
    expect(asset!.file_url).toContain('/object/public/audio-assets/music/');
    expect(await storageObjectExists('audio-assets', asset!.file_path)).toBe(
      true,
    );

    const file = await page.request.get(asset!.file_url);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toBe('audio/mpeg');

    // One upload, then a reload: the library cannot take a second upload
    // (no Upload button once it is not empty) and does not show a new asset
    // until a reload. That is KB-79; drive the second submission here once
    // it is fixed.
    await page.reload();
    await expect(page.getByText(name)).toBeVisible();

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/kb55-02-library-after-upload.png`,
      });
    }
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
