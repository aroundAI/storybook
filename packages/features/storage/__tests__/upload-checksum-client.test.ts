import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recordUploadChecksum,
  uploadWithPresignedUrl,
} from '../src/client/presigned-upload';

/**
 * KB-189: the browser hashes the file it PUT on a presigned URL and reports
 * it, so the edit package carries a SHA-256 for frames, character images,
 * shot videos and audio-library files. `fetch` is the only stand-in.
 */

const PROJECT = '18900000-0000-4000-8000-000000000001';
const PATH = `projects/${PROJECT}/shots/${PROJECT}/frames/first-frame-1.png`;
const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const SHA = createHash('sha256').update(BYTES).digest('hex');

const calls: Array<{ url: string; method: string; body: unknown }> = [];
let checksumStatus = 200;

beforeEach(() => {
  calls.length = 0;
  checksumStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      });

      if (url === '/api/storage/presign') {
        return Response.json({
          uploadUrl: 'https://r2.test/put',
          publicUrl: `https://cdn.test/project-assets/${PATH}`,
          expiresIn: 900,
          headers: { 'Content-Type': 'image/png' },
        });
      }

      if (url === '/api/storage/checksum') {
        return Response.json({}, { status: checksumStatus });
      }

      return new Response(null, { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordUploadChecksum', () => {
  it('reports the SHA-256 and size of the body it is given', async () => {
    await expect(
      recordUploadChecksum(new Blob([BYTES]), 'project-assets', PATH),
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        url: '/api/storage/checksum',
        method: 'POST',
        body: {
          bucket: 'project-assets',
          path: PATH,
          sha256: SHA,
          size: BYTES.length,
        },
      },
    ]);
  });

  it('reports nothing for an account picture, which no package lists', async () => {
    await expect(
      recordUploadChecksum(new Blob([BYTES]), 'account_image', 'x.png'),
    ).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('never fails the upload it follows', async () => {
    checksumStatus = 500;

    await expect(
      recordUploadChecksum(new Blob([BYTES]), 'project-assets', PATH),
    ).resolves.toBe(false);
  });
});

describe('uploadWithPresignedUrl', () => {
  it('presigns, PUTs, then reports the checksum of the same file', async () => {
    const file = new File([BYTES], 'frame.png', { type: 'image/png' });

    const result = await uploadWithPresignedUrl(file, 'project-assets', PATH);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/storage/presign',
      'PUT https://r2.test/put',
      'POST /api/storage/checksum',
    ]);
    expect(calls[2]!.body).toMatchObject({ path: PATH, sha256: SHA });
    expect(result.url).toBe(`https://cdn.test/project-assets/${PATH}`);
  });
});
