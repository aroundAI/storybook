import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { R2StorageAdapter } from '../src/adapters/r2';

vi.mock('server-only', () => ({}));

/**
 * FILM-2001, against a real SigV4 server: a signed read URL from the R2
 * adapter fetches the object with a plain GET inside its TTL and is refused
 * once the TTL has passed.
 *
 * Two servers, each skipped unless its variables are set (CI runs neither):
 *
 * - the local R2 sandbox (FILM-1806): local Supabase Storage's S3 endpoint
 *   and its `r2-local` bucket.
 *     set -a; eval "$(bash scripts/lib/vendor-sandbox-env.d/r2-local.sh)"; set +a
 * - MinIO (`scripts/s3-local.sh`), which answers an expired URL the way R2
 *   and S3 do: 403 AccessDenied.
 *     ./scripts/s3-local.sh up; set -a; eval "$(./scripts/s3-local.sh env)"; set +a
 *
 *   pnpm --filter @kit/storage exec vitest run __tests__/signed-read.s3-local.test.ts
 *
 * Supabase's S3 endpoint refuses an expired URL with 400 ExpiredToken, not
 * 403. Both are a refusal that names expiry, and the desktop's pull job
 * must treat either as "fetch the package again" (FILM-2011).
 *
 * The `r2-local` bucket is public, so a plain GET on the object's *public*
 * URL would succeed with no signature. The URLs tested here go to the S3
 * endpoint, which reads only the signature: that is what an expired URL
 * proves is checked.
 */

interface Server {
  name: string;
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicUrl: string;
  /** How this server refuses an expired URL. */
  expired: { status: number; code: string };
}

const SERVERS: Server[] = [];

if (process.env.VENDOR_URL_R2) {
  const bucketName = process.env.R2_BUCKET_NAME ?? 'r2-local';
  SERVERS.push({
    name: 'local R2 sandbox (Supabase S3)',
    endpoint: process.env.VENDOR_URL_R2,
    bucketName,
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    region: process.env.R2_REGION ?? 'local',
    publicUrl: process.env.R2_PUBLIC_URL ?? '',
    expired: { status: 400, code: 'ExpiredToken' },
  });
}

if (process.env.S3_LOCAL_ENDPOINT) {
  const bucketName = process.env.S3_LOCAL_BUCKET ?? 's3-local-test';
  SERVERS.push({
    name: 'MinIO',
    endpoint: process.env.S3_LOCAL_ENDPOINT,
    bucketName,
    accessKeyId: process.env.S3_LOCAL_ACCESS_KEY ?? 's3local',
    secretAccessKey: process.env.S3_LOCAL_SECRET_KEY ?? 's3localsecret',
    region: 'us-east-1',
    publicUrl: `${process.env.S3_LOCAL_ENDPOINT}/${bucketName}`,
    expired: { status: 403, code: 'AccessDenied' },
  });
}

const errorCode = (body: Buffer) =>
  /<Code>([^<]+)<\/Code>/.exec(body.toString())?.[1] ?? '';

function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type?: string; body: Buffer }>(
    (resolve, reject) => {
      const req = request(url, { method: 'GET', headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers['content-type'],
            body: Buffer.concat(chunks),
          }),
        );
      });
      req.on('error', reject);
      req.end();
    },
  );
}

// With no server configured, one skipped placeholder keeps the file a suite.
const NONE = {
  name: 'no local S3 server (set VENDOR_URL_R2 or S3_LOCAL_ENDPOINT)',
} as Server;

describe.skipIf(SERVERS.length === 0).each(SERVERS.length ? SERVERS : [NONE])(
  'R2 signed read URL on $name',
  (server) => {
    const { endpoint } = server;
    let adapter: R2StorageAdapter;
    const path = `projects/11111111-2001-4000-8000-00000000000a/shots/22222222-2001-4000-8000-00000000000b/video/film-2001-${Date.now()}.mp4`;
    const body = Buffer.from(
      Array.from({ length: 4096 }, (_, index) => index % 251),
    );

    beforeAll(async () => {
      // The one thing that must never happen: signing for the real R2 host.
      expect(new URL(endpoint).hostname).toBe('127.0.0.1');

      adapter = new R2StorageAdapter({
        accountId: 'local',
        accessKeyId: server.accessKeyId,
        secretAccessKey: server.secretAccessKey,
        bucketName: server.bucketName,
        publicUrl: server.publicUrl,
        endpoint,
        region: server.region,
        forcePathStyle: true,
      });

      await adapter.upload('project-assets', path, body, {
        contentType: 'video/mp4',
      });
    });

    afterAll(async () => {
      await adapter?.delete('project-assets', path).catch(() => undefined);
    });

    it('stat reports the stored size and type, and null for a missing key', async () => {
      expect(await adapter.stat('project-assets', path)).toEqual({
        bytes: body.byteLength,
        contentType: 'video/mp4',
      });
      expect(
        await adapter.stat('project-assets', `${path}.missing`),
      ).toBeNull();
    });

    it('a plain GET fetches the object within the TTL, and a Range GET resumes it', async () => {
      const url = await adapter.getSignedReadUrl('project-assets', path, 60);

      expect(new URL(url).host).toBe(new URL(endpoint).host);

      const whole = await get(url);
      expect(whole.status).toBe(200);
      expect(whole.body.equals(body)).toBe(true);

      const tail = await get(url, { Range: 'bytes=4000-' });
      expect(tail.status).toBe(206);
      expect(tail.body.equals(body.subarray(4000))).toBe(true);
    });

    it('is refused, naming expiry, once the TTL has passed', async () => {
      const url = await adapter.getSignedReadUrl('project-assets', path, 2);

      expect((await get(url)).status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 3500));

      const expired = await get(url);
      expect({ status: expired.status, code: errorCode(expired.body) }).toEqual(
        server.expired,
      );
      expect(expired.body.equals(body)).toBe(false);
    }, 15_000);

    it('a URL with its signature altered is refused', async () => {
      const url = new URL(
        await adapter.getSignedReadUrl('project-assets', path, 60),
      );
      const signature = url.searchParams.get('X-Amz-Signature')!;
      url.searchParams.set(
        'X-Amz-Signature',
        `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`,
      );

      const forged = await get(url.toString());
      expect(forged.status).toBe(403);
      expect(errorCode(forged.body)).toBe('SignatureDoesNotMatch');
    });
  },
);
