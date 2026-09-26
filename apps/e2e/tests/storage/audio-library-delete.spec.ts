import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  storageObjectExists,
  storageUploadAs,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-95: the audio library's Delete hid the card and deleted nothing. The
 * row kept `deleted_at = null`, and the card was back after a reload.
 *
 * Delete now asks for confirmation, soft-deletes the row as the caller (a
 * project writer), and then removes the file, unless a timeline still plays
 * it (lead decision: keep a file while a track or cue uses it). A viewer is
 * refused, and the refusal is read on a production build, where a thrown
 * action message would be replaced by a generic sentence.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const MP3 = Buffer.concat([
  Buffer.from('ID3'),
  Buffer.from([0x03, 0, 0, 0, 0, 0, 0]),
  Buffer.alloc(512, 0xff),
]);

let team: SeededTeam;
let project: SeededProject;
let viewer: SeededUser;

/**
 * An uploaded library asset, stored where the upload dialog stores one and
 * recorded as its save action records one.
 */
async function seedUploadedAsset(name: string) {
  // The key shape `audioLibraryUploadPath` makes: a UUID's first 8 are hex
  const key = `projects/${project.id}/assets/audio/${Date.now()}-${uniqueStamp().slice(0, 8)}.mp3`;

  const upload = await storageUploadAs(
    team,
    'project-assets',
    key,
    MP3,
    'audio/mpeg',
  );
  expect(upload.status, upload.body).toBe(200);

  const row = await insertRow<{ id: string; file_url: string }>(
    'audio_assets',
    {
      project_id: project.id,
      audio_type: 'sfx',
      prompt_hash: `kb95-${uniqueStamp()}`,
      prompt: name,
      name,
      file_url: `${SUPABASE_URL}/storage/v1/object/public/project-assets/${key}`,
      file_path: key,
      file_size_bytes: MP3.length,
      provider: 'upload',
      source: 'uploaded',
      status: 'completed',
    },
    serviceRoleAuth(),
  );

  return { id: row.id, fileUrl: row.file_url, key };
}

async function deleteThroughMenu(page: Page, name: string) {
  const card = page.locator('[data-test="audio-asset-card"]', {
    hasText: name,
  });
  await card.hover();
  await card.locator('[data-test="audio-asset-menu"]').click();
  await page.locator('[data-test="audio-asset-delete"]').click();
  await expect(
    page.locator('[data-test="audio-asset-delete-dialog"]'),
  ).toBeVisible();
}

async function readAsset(id: string) {
  const [row] = await readRows<{ deleted_at: string | null }>(
    'audio_assets',
    `id=eq.${id}&select=deleted_at`,
  );
  return row;
}

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb95-owner' });
  project = await seedProject(team, { name: 'KB-95 library' });
  viewer = await seedUser('kb95-viewer');
  await seedMembership(viewer.userId, team.accountId, 'member');
  await seedProjectMember(project.id, viewer.userId, 'viewer');
});

test.describe('Audio library Delete (KB-95)', () => {
  test('a writer deletes an asset: it stays gone after a reload, and its file is removed', async ({
    page,
  }) => {
    const name = `Door slam ${uniqueStamp()}`;
    const asset = await seedUploadedAsset(name);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);

    const card = page.locator('[data-test="audio-asset-card"]', {
      hasText: name,
    });
    await expect(card).toBeVisible();

    await deleteThroughMenu(page, name);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb95-01-confirm-delete.png` });
    }

    await page.locator('[data-test="audio-asset-delete-confirm"]').click();

    await expect(
      page.locator('[data-test="audio-asset-delete-dialog"]'),
    ).toBeHidden();
    await expect(card).toBeHidden();

    await page.reload();
    await expect(
      page.locator('[data-test="audio-asset-card"]', { hasText: name }),
    ).toBeHidden();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb95-02-after-reload.png` });
    }

    expect((await readAsset(asset.id))?.deleted_at).toBeTruthy();
    expect(await storageObjectExists('project-assets', asset.key)).toBe(false);
  });

  test('a file an episode still plays is kept, while the asset leaves the library', async ({
    page,
  }) => {
    const name = `Placed cue ${uniqueStamp()}`;
    const asset = await seedUploadedAsset(name);
    const { episodeId } = await seedEpisodeWithShot(project.id);

    // As the timeline actions place one: the track copies the URL
    await insertRow(
      'audio_tracks',
      {
        episode_id: episodeId,
        type: 'sfx',
        name,
        file_url: asset.fileUrl,
        duration_seconds: 1,
        timeline_start_seconds: 0,
        volume: 1,
        metadata: { audio_asset_id: asset.id },
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);

    await deleteThroughMenu(page, name);
    await page.locator('[data-test="audio-asset-delete-confirm"]').click();

    await expect(
      page.locator('[data-test="audio-asset-card"]', { hasText: name }),
    ).toBeHidden();

    expect((await readAsset(asset.id))?.deleted_at).toBeTruthy();
    expect(await storageObjectExists('project-assets', asset.key)).toBe(true);
  });

  test('a project viewer is refused, and the asset stays after a reload', async ({
    page,
  }) => {
    const name = `Viewer cannot ${uniqueStamp()}`;
    const asset = await seedUploadedAsset(name);

    await signInAs(page, viewer);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);

    await deleteThroughMenu(page, name);
    await page.locator('[data-test="audio-asset-delete-confirm"]').click();

    await expect(
      page.locator('[data-test="audio-asset-delete-error"]'),
    ).toHaveText("You can't delete assets in this project.");

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb95-03-viewer-refused.png` });
    }

    await page.reload();
    await expect(
      page.locator('[data-test="audio-asset-card"]', { hasText: name }),
    ).toBeVisible();

    expect((await readAsset(asset.id))?.deleted_at).toBeNull();
    expect(await storageObjectExists('project-assets', asset.key)).toBe(true);
  });
});
