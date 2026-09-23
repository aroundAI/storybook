import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_CONSTRAINTS,
  sanitizeFilename,
} from '@kit/assets/upload-validation';
import { R2StorageAdapter } from '@kit/storage';

import { POST } from '../route';

/**
 * KB-28: the presign route is the write gate on every storage provider.
 * On R2 it is the only one — an R2 URL is signed with the app's own
 * credentials — so each refusal is asserted on both providers, and the
 * signer must not be reached for a user who is not a writer.
 *
 * The mocked client also answers the reads the pre-KB-28 route made
 * (`projects`, `episodes`), as a user who can read a public project would
 * see them, so the old authorisation is exercised rather than short-circuited.
 */

const PROJECT = '11111111-2800-4000-8000-000000000001';
const SHOT = '11111111-2800-4000-8000-0000000000aa';

const { mockRpc, mockCreateSignedUploadUrl, mockRequireUser, mockWarn } =
  vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockCreateSignedUploadUrl: vi.fn(),
    mockRequireUser: vi.fn(),
    mockWarn: vi.fn(),
  }));

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({ info: vi.fn(), warn: mockWarn, error: vi.fn() }),
  ),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: mockRequireUser,
}));

vi.mock('@kit/supabase/server-client', () => {
  const readable = {
    select: () => readable,
    eq: () => readable,
    single: () =>
      Promise.resolve({
        data: {
          id: '11111111-2800-4000-8000-000000000001',
          project_id: '11111111-2800-4000-8000-000000000001',
        },
        error: null,
      }),
  };

  return {
    getSupabaseServerClient: () => ({
      rpc: mockRpc,
      from: () => readable,
      storage: {
        from: (bucket: string) => ({
          createSignedUploadUrl: (path: string) =>
            mockCreateSignedUploadUrl(bucket, path),
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://storage.test/${bucket}/${path}` },
          }),
        }),
      },
    }),
  };
});

function presign(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/storage/presign', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const coverUpload = {
  bucket: 'project-assets',
  path: `projects/${PROJECT}/assets/covers/cover-1.png`,
  contentType: 'image/png',
  size: 184_320,
};

// A master video, as the Publish page's master-asset manager uploads one.
const masterVideoUpload = {
  bucket: 'project-assets',
  path: `projects/${PROJECT}/assets/master_video/master_en_1790000000000.mp4`,
  contentType: 'video/mp4',
  size: 52_428_800,
};

function asWriter(canWrite: boolean) {
  mockRpc.mockResolvedValue({ data: canWrite, error: null });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ data: { id: 'user-1' }, error: null });
  mockCreateSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.test/signed' },
    error: null,
  });
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe('POST /api/storage/presign — Supabase provider', () => {
  beforeEach(() => {
    delete process.env.STORAGE_PROVIDER;
  });

  it('refuses an unauthenticated caller', async () => {
    mockRequireUser.mockResolvedValue({ data: null, error: new Error('no') });

    const res = await presign(coverUpload);

    expect(res.status).toBe(401);
  });

  it('refuses a user who can read a public project but has no role on it', async () => {
    asWriter(false);

    const res = await presign(coverUpload);

    expect(res.status).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith('can_write_project_storage', {
      path: coverUpload.path,
    });
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('signs for a project writer', async () => {
    asWriter(true);

    const res = await presign(coverUpload);

    expect(res.status).toBe(200);
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith(
      'project-assets',
      coverUpload.path,
    );
    await expect(res.json()).resolves.toMatchObject({
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('caps the declared size on this provider too', async () => {
    asWriter(true);

    const res = await presign({ ...coverUpload, size: 12 * 1024 * 1024 });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'File is 12 MB; images may be at most 10 MB',
    });
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses a bucket the app does not upload to', async () => {
    asWriter(true);

    const res = await presign({ ...coverUpload, bucket: 'reports' });

    expect(res.status).toBe(400);
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    'image/svg+xml',
    'text/html',
    'application/pdf',
    'video/x-matroska',
  ])(
    'refuses %s, which UPLOAD_CONSTRAINTS does not list',
    async (contentType) => {
      asWriter(true);

      const res = await presign({ ...coverUpload, contentType });

      expect(res.status).toBe(400);
      expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it('refuses a malformed body', async () => {
    const res = await presign({ bucket: 'project-assets' });

    expect(res.status).toBe(400);
  });

  it('applies the same rule to audio: a writer may, a reader may not', async () => {
    const audio = {
      bucket: 'project-assets',
      path: `projects/${PROJECT}/assets/audio/track.mp3`,
      contentType: 'audio/mpeg',
      size: 4_000_000,
    };

    asWriter(true);
    expect((await presign(audio)).status).toBe(200);

    asWriter(false);
    expect((await presign(audio)).status).toBe(403);
  });

  it('accepts an underscore shot-video name as use-video-upload builds it', async () => {
    asWriter(true);
    // use-video-upload.ts: `${timestamp}-${sanitizeFilename(file.name)}`
    const name = `1790000000000-${sanitizeFilename('My Clip_final.mp4')}`;
    expect(name).toContain('_');

    const res = await presign({
      bucket: 'project-assets',
      path: `projects/${PROJECT}/shots/${SHOT}/video/${name}`,
      contentType: 'video/mp4',
      size: 10_000_000,
    });

    expect(res.status).toBe(200);
  });

  it.each([
    [
      'a parent segment after an underscore folder',
      `projects/${PROJECT}/assets/a_b/../x.mp4`,
    ],
    ['a bare .. filename', `projects/${PROJECT}/assets/master_video/..`],
    [
      'a .. inside the filename',
      `projects/${PROJECT}/assets/master_video/a..b.mp4`,
    ],
    ['an empty segment', `projects/${PROJECT}/assets//x.mp4`],
    ['an extra segment', `projects/${PROJECT}/assets/master_video/a_b/x.mp4`],
  ])('refuses %s', async (_label, path) => {
    asWriter(true);

    const res = await presign({ ...masterVideoUpload, path });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid storage path format',
    });
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/storage/presign — R2 provider', () => {
  let signR2: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Dummy values: the adapter's constructor requires them. Nothing reaches R2.
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET_NAME = 'test-bucket';
    process.env.R2_PUBLIC_URL = 'https://r2.test';

    signR2 = vi
      .spyOn(R2StorageAdapter.prototype, 'getSignedUploadUrl')
      .mockImplementation(async (_bucket, _path, request) => ({
        uploadUrl: 'https://r2.test/signed',
        publicUrl: 'https://r2.test/public',
        expiresIn: 900,
        headers: { 'Content-Type': request.contentType },
      }));
  });

  it('refuses a public-project reader before the R2 signer is reached', async () => {
    asWriter(false);

    const res = await presign(coverUpload);

    expect(res.status).toBe(403);
    expect(signR2).not.toHaveBeenCalled();
  });

  it('refuses an unlisted bucket before the R2 signer is reached', async () => {
    asWriter(true);

    const res = await presign({ ...coverUpload, bucket: 'account_image' });

    expect(res.status).toBe(400);
    expect(signR2).not.toHaveBeenCalled();
  });

  it('refuses an unlisted type before the R2 signer is reached', async () => {
    asWriter(true);

    const res = await presign({ ...coverUpload, contentType: 'text/html' });

    expect(res.status).toBe(400);
    expect(signR2).not.toHaveBeenCalled();
  });

  it('signs with R2 for a project writer', async () => {
    asWriter(true);

    const res = await presign(coverUpload);

    expect(res.status).toBe(200);
    expect(signR2).toHaveBeenCalledWith('project-assets', coverUpload.path, {
      contentType: 'image/png',
      contentLength: coverUpload.size,
      expiresIn: 900,
    });
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
  });

  // KB-38: the URL binds a type and an exact length, so both must be the
  // ones the route checked.
  it('signs the lower-cased type it checked, and returns the headers to send', async () => {
    asWriter(true);

    const res = await presign({ ...coverUpload, contentType: 'IMAGE/PNG' });

    expect(res.status).toBe(200);
    expect(signR2).toHaveBeenCalledWith('project-assets', coverUpload.path, {
      contentType: 'image/png',
      contentLength: coverUpload.size,
      expiresIn: 900,
    });
    await expect(res.json()).resolves.toMatchObject({
      uploadUrl: 'https://r2.test/signed',
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('refuses a missing size before the R2 signer is reached', async () => {
    asWriter(true);

    const { size: _size, ...withoutSize } = coverUpload;
    const res = await presign(withoutSize);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing required fields: bucket, path, contentType, size',
    });
    expect(signR2).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '1000'])('refuses a size of %j', async (size) => {
    asWriter(true);

    const res = await presign({ ...coverUpload, size });

    expect(res.status).toBe(400);
    expect(signR2).not.toHaveBeenCalled();
  });

  it.each([
    [
      'image',
      'image/png',
      UPLOAD_CONSTRAINTS.image.maxSize,
      'images may be at most 10 MB',
    ],
    [
      'video',
      'video/mp4',
      UPLOAD_CONSTRAINTS.video.maxSize,
      'videos may be at most 500 MB',
    ],
    [
      'audio',
      'audio/mpeg',
      UPLOAD_CONSTRAINTS.audio.maxSize,
      'audio files may be at most 50 MB',
    ],
  ])(
    'signs %s at exactly its ceiling and refuses one byte more',
    async (_category, contentType, maxSize, message) => {
      asWriter(true);

      const atMax = await presign({
        ...coverUpload,
        contentType,
        size: maxSize,
      });
      expect(atMax.status).toBe(200);
      expect(signR2).toHaveBeenLastCalledWith(
        'project-assets',
        coverUpload.path,
        { contentType, contentLength: maxSize, expiresIn: 900 },
      );

      signR2.mockClear();

      const over = await presign({
        ...coverUpload,
        contentType,
        size: maxSize + 1,
      });
      expect(over.status).toBe(400);
      const { error } = (await over.json()) as { error: string };
      expect(error).toContain(message);
      expect(signR2).not.toHaveBeenCalled();
    },
  );
});
