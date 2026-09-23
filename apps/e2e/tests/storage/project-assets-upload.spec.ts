import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  readRows,
  readRowsAs,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  storageObjectExists,
  storageUploadAs,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-28: only a project's writers may put files in its storage folder.
 *
 * A legitimate upload is driven through the real settings page and the real
 * presign route; the refusals are driven the way an attacker would — through
 * the app's route and straight at the Storage API with their own session —
 * against a project they can read because it is public.
 *
 * Runs against the local Supabase stack (STORAGE_PROVIDER=supabase), where
 * the bucket policies are also in play. The R2 path is covered by
 * apps/web/app/api/storage/presign/__tests__/route.test.ts.
 *
 * KB-38: an upload URL is signed for one declared size and type, so the
 * cover upload also checks what the page declares and sends, and the route's
 * size refusals are driven here. That R2 refuses a mismatched PUT is shown
 * against a real S3 server in s3-presign.s3-local.test.ts.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour 160x90 PNG, so each upload is visibly different. */
function png([r, g, b]: [number, number, number]) {
  const width = 160;
  const height = 90;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat()),
  ]);
  const pixels = deflateSync(Buffer.concat(Array(height).fill(row)));

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEAL: [number, number, number] = [20, 160, 150];
const AMBER: [number, number, number] = [230, 150, 30];

let team: SeededTeam;
let project: SeededProject;
let member: SeededUser;
let stranger: SeededUser;

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb28-owner' });
  project = await seedProject(team, { name: 'KB-28 storage' });

  member = await seedUser('kb28-member');
  await seedMembership(member.userId, team.accountId);
  await seedProjectMember(project.id, member.userId, 'member');

  // Public, so the stranger can read it: reading is not writing.
  stranger = await seedUser('kb28-stranger');
  await updateRows('projects', `id=eq.${project.id}`, { visibility: 'public' });
});

test.describe('Project storage (KB-28)', () => {
  test('the owner uploads a cover through settings, twice', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/settings`);

    const input = page.locator('[data-test="cover-image-input"]');
    const preview = page.locator('[data-test="cover-image-preview"]');
    const storedPrefix = `/project-assets/projects/${project.id}/assets/covers/`;

    // KB-38: what the page declares when it asks for an upload URL, and what
    // it then sends with the PUT.
    const declared: { contentType: string; size: number }[] = [];
    const putTypes: (string | undefined)[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/storage/presign')) {
        declared.push(request.postDataJSON());
      } else if (request.method() === 'PUT') {
        putTypes.push(request.headers()['content-type']);
      }
    });

    // On a production build the page can render before React attaches the
    // input's onChange, and a file chosen then is silently ignored. Choose
    // again until the handler has visibly run (it shows a preview at once);
    // nothing is uploaded until it does, so a retry cannot double-upload.
    const chooseCover = async (buffer: Buffer, previousSrc: string | null) => {
      await expect(async () => {
        await input.setInputFiles({
          name: 'cover.png',
          mimeType: 'image/png',
          buffer,
        });
        await expect(preview).toBeVisible({ timeout: 2_000 });
        if (previousSrc) {
          await expect(preview).not.toHaveAttribute('src', previousSrc, {
            timeout: 2_000,
          });
        }
      }).toPass({ timeout: 20_000 });
    };

    // First upload
    await chooseCover(png(TEAL), null);

    await expect(
      page.getByText('Cover image updated successfully').first(),
    ).toBeVisible();
    await expect(preview).toHaveAttribute('src', new RegExp(storedPrefix));

    expect(declared).toEqual([
      expect.objectContaining({
        contentType: 'image/png',
        size: png(TEAL).length,
      }),
    ]);
    expect(putTypes).toEqual(['image/png']);

    const first = (await preview.getAttribute('src'))!;
    expect((await page.request.get(first)).status()).toBe(200);

    if (evidence) {
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/01-cover-after-first-upload.png` });
    }

    // Second upload: a new object and a new URL, and the saved metadata
    // follows it rather than keeping the first.
    await chooseCover(png(AMBER), first);

    await expect(preview).not.toHaveAttribute('src', first);
    await expect(preview).toHaveAttribute('src', new RegExp(storedPrefix));

    const second = (await preview.getAttribute('src'))!;
    expect((await page.request.get(second)).status()).toBe(200);

    expect(declared.map((body) => body.size)).toEqual([
      png(TEAL).length,
      png(AMBER).length,
    ]);
    expect(putTypes).toEqual(['image/png', 'image/png']);

    const [row] = await readRows<{ metadata: { coverImageUrl?: string } }>(
      'projects',
      `id=eq.${project.id}&select=metadata`,
    );
    expect(row?.metadata.coverImageUrl).toBe(second);

    if (evidence) {
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${OUT}/02-cover-after-second-upload.png`,
      });
    }
  });

  test('a project member presigns and uploads', async ({ page }) => {
    await signInAs(page, member);

    const path = `projects/${project.id}/assets/character/member-${Date.now()}.png`;

    const presign = await page.request.post('/api/storage/presign', {
      data: {
        bucket: 'project-assets',
        path,
        contentType: 'image/png',
        size: png(TEAL).length,
      },
    });
    expect(presign.status()).toBe(200);

    const { uploadUrl } = (await presign.json()) as { uploadUrl: string };
    const put = await page.request.put(uploadUrl, {
      data: png(TEAL),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.status()).toBe(200);

    expect(await storageObjectExists('project-assets', path)).toBe(true);
  });

  test('a stranger who can read the public project cannot upload to it', async ({
    page,
  }) => {
    const visible = await readRowsAs<{ id: string }>(
      stranger,
      'projects',
      `id=eq.${project.id}&select=id`,
    );
    expect(visible, 'precondition: the stranger can read it').toHaveLength(1);

    await signInAs(page, stranger);

    // Through the app
    const viaRoute = `projects/${project.id}/assets/character/route-planted.png`;
    const presign = await page.request.post('/api/storage/presign', {
      data: {
        bucket: 'project-assets',
        path: viaRoute,
        contentType: 'image/png',
        size: png(AMBER).length,
      },
    });
    expect(presign.status()).toBe(403);
    expect(await storageObjectExists('project-assets', viaRoute)).toBe(false);

    // Around the app, with their own session
    const direct = `projects/${project.id}/assets/character/direct-planted.png`;
    const upload = await storageUploadAs(
      stranger,
      'project-assets',
      direct,
      png(AMBER),
      'image/png',
    );
    expect(upload.status, upload.body).not.toBe(200);
    expect(upload.body).toContain('row-level security');
    expect(await storageObjectExists('project-assets', direct)).toBe(false);
  });

  test('an upload URL needs a size, within the limit for its type (KB-38)', async ({
    page,
  }) => {
    await signInAs(page, team);

    const path = `projects/${project.id}/assets/character/sized-${Date.now()}.png`;
    const ask = (extra: Record<string, unknown>) =>
      page.request.post('/api/storage/presign', {
        data: { bucket: 'project-assets', path, contentType: 'image/png', ...extra },
      });

    const unsized = await ask({});
    expect(unsized.status()).toBe(400);
    expect(await unsized.json()).toEqual({
      error: 'Missing required fields: bucket, path, contentType, size',
    });

    const tooLarge = await ask({ size: 10 * 1024 * 1024 + 1 });
    expect(tooLarge.status()).toBe(400);
    expect(await tooLarge.json()).toEqual({
      error: 'File is 10.0 MB; images may be at most 10 MB',
    });

    const atLimit = await ask({ size: 10 * 1024 * 1024 });
    expect(atLimit.status()).toBe(200);
    expect(await atLimit.json()).toMatchObject({
      headers: { 'Content-Type': 'image/png' },
    });

    expect(await storageObjectExists('project-assets', path)).toBe(false);
  });

  test('the bucket refuses a type the product does not store, even from the owner', async () => {
    const name = `projects/${project.id}/assets/character/page-${Date.now()}.html`;

    const upload = await storageUploadAs(
      team,
      'project-assets',
      name,
      '<script>alert(document.domain)</script>',
      'text/html',
    );

    expect(upload.status, upload.body).not.toBe(200);
    expect(await storageObjectExists('project-assets', name)).toBe(false);
  });
});
