import { beforeAll, describe, expect, it } from 'vitest';

import { R2StorageAdapter } from '@kit/storage';
import { episodeRenderKey } from '@kit/storage/upload-paths';

/**
 * FILM-2003 on a real SigV4 server: request_render_upload signs a render's
 * key for its exact size and type, and finalize_render reads the stored
 * size back with `stat` (a HEAD). A PUT of another size is refused and
 * stores nothing, so `stat` stays null and the render fails with a reason.
 *
 * Needs the local S3 server, which CI does not run, so it is skipped unless
 * S3_LOCAL_ENDPOINT is set (see s3-presign.s3-local.test.ts):
 *
 *   ./scripts/s3-local.sh up
 *   set -a; eval "$(./scripts/s3-local.sh env)"; set +a
 *   pnpm --filter web exec vitest run app/api/storage/presign/__tests__/render-upload.s3-local.test.ts
 */
const endpoint = process.env.S3_LOCAL_ENDPOINT;
const bucket = process.env.S3_LOCAL_BUCKET ?? 's3-local-test';

const PROJECT = '11111111-2003-4000-8000-000000000001';
const EPISODE = '11111111-2003-4000-8000-000000000002';

describe.skipIf(!endpoint)('a render upload on a real S3 server', () => {
  let adapter: R2StorageAdapter;

  beforeAll(() => {
    adapter = new R2StorageAdapter({
      accountId: 'local',
      accessKeyId: process.env.S3_LOCAL_ACCESS_KEY ?? 's3local',
      secretAccessKey: process.env.S3_LOCAL_SECRET_KEY ?? 's3localsecret',
      bucketName: bucket,
      publicUrl: `${endpoint}/${bucket}`,
      endpoint,
    });

    expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  });

  async function sign(renderId: string, size: number) {
    const key = episodeRenderKey(PROJECT, EPISODE, renderId);
    const signed = await adapter.getSignedUploadUrl('project-assets', key, {
      contentType: 'video/mp4',
      contentLength: size,
      expiresIn: 3600,
    });

    return { key, signed };
  }

  it('stores the signed size, and stat reads it back', async () => {
    const body = new Uint8Array(4096).fill(7);
    const { key, signed } = await sign(crypto.randomUUID(), body.byteLength);

    expect(await adapter.stat('project-assets', key)).toBeNull();

    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });

    expect(put.status).toBe(200);
    expect(await adapter.stat('project-assets', key)).toEqual({
      bytes: 4096,
      contentType: 'video/mp4',
    });
  });

  it('refuses a body of another size, so nothing is stored', async () => {
    const { key, signed } = await sign(crypto.randomUUID(), 4096);

    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body: new Uint8Array(5000).fill(7),
    });

    expect(put.ok).toBe(false);
    expect(await adapter.stat('project-assets', key)).toBeNull();
  });
});
