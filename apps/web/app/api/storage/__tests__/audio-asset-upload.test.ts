import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { R2StorageAdapter } from '@kit/storage';

import { uploadAudioFileAndCreateAssetAction } from '../../../../../../packages/features/audio-generation/src/server/audio-asset-actions';

/**
 * KB-55: the audio library's upload, through the real storage factory.
 *
 * On the Supabase provider (every local and CI environment) the action used
 * to call `getStorageAdapter()` with no client, which throws before any
 * bucket is involved. On R2 (production) the same call writes the
 * `audio-assets/…` key. Both are asserted, and the action refuses a
 * non-audio type before anything is stored (D4).
 *
 * Lives in apps/web because CI's unit list runs `web`, not
 * `@kit/audio-generation`.
 */

const PROJECT = '11111111-5500-4000-8000-000000000001';

const { adminUpload, adminFrom, r2Send, mockRequireUser } = vi.hoisted(() => ({
  adminUpload: vi.fn(),
  adminFrom: vi.fn(),
  r2Send: vi.fn(),
  mockRequireUser: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  ),
}));

vi.mock(
  '../../../../../../packages/features/audio-generation/src/server/project-audio-settings',
  () => ({ getProjectElevenLabsApiKey: vi.fn() }),
);

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (fn: (input: unknown) => unknown) => fn,
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: mockRequireUser,
}));

vi.mock('@kit/supabase/server-client', () => {
  const row = {
    id: 'asset-1',
    asset_id: null,
    project_id: '11111111-5500-4000-8000-000000000001',
    audio_type: 'music',
    prompt_hash: 'h',
    prompt: 'Score',
    name: 'Score',
    file_url: 'stored',
    file_path: 'music/x.mp3',
    duration_seconds: null,
    file_size_bytes: 3,
    provider: 'upload',
    provider_job_id: null,
    status: 'completed',
    metadata: {},
    usage_count: 0,
    last_used_at: null,
    created_at: '2026-09-23T00:00:00Z',
    updated_at: '2026-09-23T00:00:00Z',
  };
  const chain = {
    insert: () => chain,
    select: () => chain,
    single: () => Promise.resolve({ data: row, error: null }),
  };

  return { getSupabaseServerClient: () => ({ from: () => chain }) };
});

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    storage: {
      from: (bucket: string) => {
        adminFrom(bucket);
        return {
          upload: adminUpload,
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://storage.test/${bucket}/${path}` },
          }),
        };
      },
    },
  }),
}));

const input = (contentType: string) => ({
  projectId: PROJECT,
  audioType: 'music' as const,
  name: 'Score',
  fileBase64: Buffer.from('ID3').toString('base64'),
  fileName: 'my score.mp3',
  contentType,
  fileSizeBytes: 3,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ data: { id: 'user-1' }, error: null });
  adminUpload.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  delete process.env.STORAGE_PROVIDER;
});

describe('uploadAudioFileAndCreateAssetAction (KB-55)', () => {
  describe('Supabase provider', () => {
    beforeEach(() => {
      process.env.STORAGE_PROVIDER = 'supabase';
    });

    it('stores the file in the audio-assets bucket with the server client', async () => {
      const result = await uploadAudioFileAndCreateAssetAction(
        input('audio/mpeg'),
      );

      expect(result).toMatchObject({ ok: true });
      expect(adminFrom).toHaveBeenCalledWith('audio-assets');
      expect(adminUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^music\/\d+-my_score\.mp3$/),
        expect.any(Buffer),
        expect.objectContaining({ contentType: 'audio/mpeg' }),
      );
    });

    it('refuses a non-audio type, as a value, before storing anything', async () => {
      const result = await uploadAudioFileAndCreateAssetAction(
        input('text/html'),
      );

      expect(result).toEqual({
        ok: false,
        error: "This file type isn't supported.",
      });
      expect(adminUpload).not.toHaveBeenCalled();
    });
  });

  describe('R2 provider', () => {
    beforeEach(() => {
      process.env.STORAGE_PROVIDER = 'r2';
      process.env.R2_ACCOUNT_ID = 'test-account';
      process.env.R2_ACCESS_KEY_ID = 'test-key';
      process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
      process.env.R2_BUCKET_NAME = 'test-bucket';
      process.env.R2_PUBLIC_URL = 'https://r2.test';

      // The real adapter builds the key; only the network call is recorded.
      const upload = R2StorageAdapter.prototype.upload;
      vi.spyOn(R2StorageAdapter.prototype, 'upload').mockImplementation(
        async function (this: R2StorageAdapter, ...args) {
          (this as unknown as { s3Client: { send: typeof r2Send } }).s3Client.send =
            r2Send;
          return upload.apply(this, args);
        },
      );
      r2Send.mockResolvedValue({});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes the audio-assets/ key in the one R2 bucket', async () => {
      const result = await uploadAudioFileAndCreateAssetAction(
        input('audio/mpeg'),
      );

      expect(result).toMatchObject({ ok: true });
      const [command] = r2Send.mock.calls[0]!;
      expect(command.input).toMatchObject({
        Bucket: 'test-bucket',
        Key: expect.stringMatching(/^audio-assets\/music\/\d+-my_score\.mp3$/),
        ContentType: 'audio/mpeg',
      });
      expect(adminUpload).not.toHaveBeenCalled();
    });

    it('refuses a non-audio type before anything reaches R2', async () => {
      const result = await uploadAudioFileAndCreateAssetAction(
        input('text/html'),
      );

      expect(result).toMatchObject({ ok: false });
      expect(r2Send).not.toHaveBeenCalled();
    });
  });
});
