import { request } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';

import { R2StorageAdapter } from '@kit/storage';

/**
 * KB-38, against a real SigV4 server: the upload URL the R2 adapter signs
 * admits one PUT, with the type and exact size it was issued for, and
 * refuses anything else without storing it.
 *
 * Needs the local S3 server, which CI does not run, so it is skipped unless
 * S3_LOCAL_ENDPOINT is set:
 *
 *   ./scripts/s3-local.sh up
 *   set -a; eval "$(./scripts/s3-local.sh env)"; set +a
 *   pnpm --filter web exec vitest run app/api/storage/presign/__tests__/s3-presign.s3-local.test.ts
 *
 * Requests go through `node:http`, not the test environment's `fetch`
 * (happy-dom's, which applies browser rules of its own). Each PUT sends a
 * `Content-Length` equal to its body's size, as a browser does for a File or
 * Blob, so "a larger body" means the body and its length both grew.
 */

const endpoint = process.env.S3_LOCAL_ENDPOINT;
const bucket = process.env.S3_LOCAL_BUCKET ?? 's3-local-test';

const PNG_SIZE = 1000;

function png(size = PNG_SIZE) {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  return bytes;
}

let counter = 0;

describe.skipIf(!endpoint)('R2 upload URL on a real S3 server', () => {
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

    // The one thing that must never happen: signing for the real R2 host.
    expect(new URL(endpoint!).hostname).toBe('127.0.0.1');
  });

  async function signPng() {
    const path = `projects/p/assets/covers/kb38-${Date.now()}-${++counter}.png`;

    const signed = await adapter.getSignedUploadUrl('project-assets', path, {
      contentType: 'image/png',
      contentLength: PNG_SIZE,
      expiresIn: 900,
    });

    expect(new URL(signed.uploadUrl).host).toBe(new URL(endpoint!).host);

    return signed;
  }

  function send(
    method: 'GET' | 'PUT',
    url: string,
    body?: Uint8Array,
    headers: Record<string, string> = {},
  ) {
    return new Promise<{
      status: number;
      type: string | undefined;
      body: Buffer;
    }>((resolve, reject) => {
      const req = request(
        url,
        {
          method,
          headers: body
            ? { ...headers, 'Content-Length': String(body.byteLength) }
            : headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              type: res.headers['content-type'],
              body: Buffer.concat(chunks),
            }),
          );
        },
      );

      req.on('error', reject);
      req.end(body ? Buffer.from(body) : undefined);
    });
  }

  async function put(
    uploadUrl: string,
    body: Uint8Array,
    headers: Record<string, string>,
  ) {
    const response = await send('PUT', uploadUrl, body, headers);

    return {
      status: response.status,
      code: /<Code>([^<]+)<\/Code>/.exec(response.body.toString())?.[1] ?? '',
    };
  }

  async function stored(publicUrl: string) {
    const response = await send('GET', publicUrl);

    return response.status === 200
      ? { size: response.body.byteLength, type: response.type }
      : null;
  }

  it('stores the matching PUT with the declared type and size', async () => {
    const { uploadUrl, publicUrl, headers } = await signPng();

    const result = await put(uploadUrl, png(), headers);

    expect(result.status).toBe(200);
    expect(await stored(publicUrl)).toEqual({
      size: PNG_SIZE,
      type: 'image/png',
    });
  });

  it.each([
    ['a different Content-Type', png(), { 'Content-Type': 'text/html' }],
    ['no Content-Type', png(), {}],
    ['a larger body', png(5 * PNG_SIZE), { 'Content-Type': 'image/png' }],
    ['a smaller body', png(PNG_SIZE / 2), { 'Content-Type': 'image/png' }],
  ])('refuses a PUT with %s and stores nothing', async (_label, body, sent) => {
    const { uploadUrl, publicUrl } = await signPng();

    const result = await put(uploadUrl, body, sent);

    expect(result.status, result.code).toBeGreaterThanOrEqual(400);
    expect(await stored(publicUrl)).toBeNull();
  });
});
