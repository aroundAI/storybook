import { type Page, expect, test } from '@playwright/test';

import {
  type SeededTeam,
  type SeededUser,
  readRows,
  seedTeamAccount,
  seedUser,
  storageObjectExists,
  storageUploadAs,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { png } from './png';

/**
 * KB-53: avatar upload was broken on every attempt. The presign route did
 * not sign the `account_image` bucket, the path `uploadAvatar` built failed
 * the route's pattern, and the bucket's policy — which reads the file name as
 * the owning account's id — raised on `avatar-<ts>` instead of deciding.
 *
 * An avatar now lives at `account_image/<accountId>.<ext>`: the name the
 * policy expects, one per account, replaced by each upload, with a version
 * query on the stored URL so the new picture is not served from a cache.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase), where
 * the bucket policy is also in play. The R2 path is covered by
 * apps/web/app/api/storage/presign/__tests__/route.test.ts.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const TEAL: [number, number, number] = [20, 160, 150];
const AMBER: [number, number, number] = [230, 150, 30];
const VIOLET: [number, number, number] = [120, 60, 200];

let user: SeededUser;
let team: SeededTeam;
let stranger: SeededUser;

test.beforeAll(async () => {
  user = await seedUser('kb53-user');
  team = await seedTeamAccount({ emailPrefix: 'kb53-owner' });
  stranger = await seedUser('kb53-stranger');
});

async function pictureUrl(accountId: string) {
  const [row] = await readRows<{ picture_url: string | null }>(
    'accounts',
    `id=eq.${accountId}&select=picture_url`,
  );

  return row?.picture_url ?? null;
}

/**
 * Choose a picture, retrying until the save lands. On a production build the
 * page can render before React attaches the input's handler, and a file
 * chosen then is ignored. A retry after a successful save only overwrites the
 * same key with the same bytes.
 */
async function choosePicture(
  page: Page,
  accountId: string,
  buffer: Buffer,
  previous: string | null,
) {
  const input = page.locator('input[type="file"][accept="image/*"]').first();

  await expect(async () => {
    await input.setInputFiles({
      name: 'picture.png',
      mimeType: 'image/png',
      buffer,
    });
    await expect
      .poll(() => pictureUrl(accountId), { timeout: 5_000 })
      .not.toBe(previous);
  }).toPass({ timeout: 30_000 });

  return (await pictureUrl(accountId))!;
}

test.describe('Account pictures (KB-53)', () => {
  test('a user sets their picture, then replaces it', async ({ page }) => {
    await signInAs(page, user);
    await page.goto('/home/settings');
    await expect(
      page.getByText('Upload a Profile Picture').first(),
    ).toBeVisible();

    const stored = new RegExp(`/account_image/${user.userId}\\.png\\?v=\\d+$`);

    const first = await choosePicture(page, user.userId, png(TEAL), null);

    expect(first).toMatch(stored);
    await expect(
      page.getByText('Profile successfully updated').first(),
    ).toBeVisible();
    expect(
      await storageObjectExists('account_image', `${user.userId}.png`),
    ).toBe(true);

    const firstBody = await page.request.get(first);
    expect(firstBody.status()).toBe(200);
    expect(Buffer.from(await firstBody.body()).equals(png(TEAL))).toBe(true);

    if (evidence) {
      await page.reload();
      await expect(
        page.getByText('Upload a Profile Picture').first(),
      ).toBeVisible();
      await expect(page.locator(`img[src="${first}"]`).first()).toBeVisible();
      await page.screenshot({ path: `${OUT}/kb53-01-avatar-first-upload.png` });
    }

    // The second upload replaces the same object, under a new URL.
    const second = await choosePicture(page, user.userId, png(AMBER), first);

    expect(second).toMatch(stored);
    expect(second).not.toBe(first);

    const secondBody = await page.request.get(second);
    expect(Buffer.from(await secondBody.body()).equals(png(AMBER))).toBe(true);

    // What the page shows after a reload is the stored URL, not a local preview.
    await page.reload();
    await expect(page.locator(`img[src="${second}"]`).first()).toBeVisible();

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/kb53-02-avatar-second-upload.png`,
      });
    }
  });

  test('a team owner sets the team picture', async ({ page }) => {
    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings`);
    await expect(
      page.getByText('Upload a Profile Picture').first(),
    ).toBeVisible();

    const url = await choosePicture(page, team.accountId, png(VIOLET), null);

    expect(url).toMatch(
      new RegExp(`/account_image/${team.accountId}\\.png\\?v=\\d+$`),
    );
    await expect(
      page.getByText('Team successfully updated').first(),
    ).toBeVisible();
    expect(
      await storageObjectExists('account_image', `${team.accountId}.png`),
    ).toBe(true);

    if (evidence) {
      await page.reload();
      await expect(
        page.getByText('Upload a Profile Picture').first(),
      ).toBeVisible();
      await expect(page.locator(`img[src="${url}"]`).first()).toBeVisible();
      await page.screenshot({ path: `${OUT}/kb53-03-team-picture.png` });
    }
  });

  test("nobody may write another account's picture", async ({ page }) => {
    await signInAs(page, stranger);

    const presign = (path: string) =>
      page.request.post('/api/storage/presign', {
        data: {
          bucket: 'account_image',
          path,
          contentType: 'image/png',
          size: png(TEAL).length,
        },
      });

    // Another user's, and a team the stranger does not belong to
    expect((await presign(`${user.userId}.png`)).status()).toBe(403);
    expect((await presign(`${team.accountId}.jpg`)).status()).toBe(403);

    // Their own is fine; the path the old uploader built is not
    expect((await presign(`${stranger.userId}.png`)).status()).toBe(200);
    expect(
      (await presign(`${stranger.userId}/avatar-1790000000000.png`)).status(),
    ).toBe(400);

    // Around the app, with their own session: the bucket policy refuses too.
    const direct = await storageUploadAs(
      stranger,
      'account_image',
      `${team.accountId}.gif`,
      png(AMBER),
      'image/png',
    );
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect(
      await storageObjectExists('account_image', `${team.accountId}.gif`),
    ).toBe(false);
  });
});
