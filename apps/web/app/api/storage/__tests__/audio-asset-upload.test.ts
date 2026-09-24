import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { R2StorageAdapter } from '@kit/storage';

import { createUploadedAudioAssetAction } from '../../../../../../packages/features/audio-generation/src/server/audio-asset-actions';

/**
 * KB-73: the audio library's save step, after the browser has PUT the file
 * straight to storage through the presign route.
 *
 * Before, the dialog sent the file as base64 in a server-action body, so
 * anything over about 750 KB hit Next's 1 MB limit. And the action wrote the
 * file with the admin client, at a key naming no project, before anything
 * checked the project: a stranger's call stored its bytes and only then had
 * the row refused (KB-57, audio leg). This action receives no bytes. It
 * accepts a key only inside the caller's own project's audio folder, only
 * from a project writer, and only once the object is there, and it builds the
 * URL itself.
 *
 * Lives in apps/web because CI's unit list runs `web`, not
 * `@kit/audio-generation`.
 */

const PROJECT = '11111111-7300-4000-8000-000000000001';
const OTHER = '11111111-7300-4000-8000-000000000002';
const ACCOUNT = '11111111-7300-4000-8000-0000000000aa';
const PATH = `projects/${PROJECT}/assets/audio/1790000000000-0a1b2c3d.mp3`;

const {
  mockRequireUser,
  canWrite,
  existingRows,
  inserted,
  insertError,
  listed,
  removed,
  r2Send,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  canWrite: { value: true },
  existingRows: { value: [] as unknown[] },
  inserted: vi.fn(),
  insertError: { value: null as null | { message: string; code: string } },
  listed: vi.fn(),
  removed: vi.fn(),
  r2Send: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
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

function rowFor(values: Record<string, unknown>) {
  return {
    id: 'asset-1',
    asset_id: null,
    duration_seconds: null,
    provider_job_id: null,
    usage_count: 0,
    last_used_at: null,
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    ...values,
  };
}

/** The caller's own client: RLS-bound reads, `can_write_project`, the insert */
vi.mock('@kit/supabase/server-client', () => {
  const client = {
    rpc: (fn: string, args: { target_project_id: string }) =>
      Promise.resolve({
        data:
          fn === 'can_write_project' &&
          canWrite.value &&
          args.target_project_id === PROJECT,
        error: null,
      }),
    from: (table: string) => {
      if (table === 'projects') {
        let id = '';
        const chain = {
          select: () => chain,
          eq: (_column: string, value: string) => {
            id = value;
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: { id, account_id: ACCOUNT },
              error: null,
            }),
        };
        return chain;
      }

      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: () => Promise.resolve({ data: existingRows.value, error: null }),
        insert: (values: Record<string, unknown>) => {
          inserted(values);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  insertError.value
                    ? { data: null, error: insertError.value }
                    : { data: rowFor(values), error: null },
                ),
            }),
          };
        },
      };
      return chain;
    },
  };

  return { getSupabaseServerClient: () => client };
});

/** Storage reads and the clean-up delete go through the server's client */
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        list: (dir: string, options: { search: string }) => {
          listed(bucket, dir, options.search);
          const exists = `${dir}/${options.search}` === PATH;
          return Promise.resolve({
            data: exists ? [{ name: options.search }] : [],
            error: null,
          });
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.test/${bucket}/${path}` },
        }),
        remove: (paths: string[]) => {
          removed(bucket, paths);
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
  }),
}));

const input = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  audioType: 'music' as const,
  name: 'Opening theme',
  path: PATH,
  contentType: 'audio/mpeg' as const,
  fileSizeBytes: 2 * 1024 * 1024,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ data: { id: 'user-1' }, error: null });
  canWrite.value = true;
  existingRows.value = [];
  insertError.value = null;
  process.env.STORAGE_PROVIDER = 'supabase';
});

afterEach(() => {
  delete process.env.STORAGE_PROVIDER;
});

describe('createUploadedAudioAssetAction (KB-73)', () => {
  it("saves a writer's upload with a URL the server built from the key", async () => {
    const result = await createUploadedAudioAssetAction(input());

    expect(result).toMatchObject({ ok: true });
    expect(inserted).toHaveBeenCalledTimes(1);
    expect(inserted.mock.calls[0]![0]).toMatchObject({
      project_id: PROJECT,
      audio_type: 'music',
      name: 'Opening theme',
      file_path: PATH,
      file_url: `https://storage.test/project-assets/${PATH}`,
      file_size_bytes: 2 * 1024 * 1024,
      provider: 'upload',
      status: 'completed',
      metadata: { source: 'uploaded', contentType: 'audio/mpeg' },
    });
  });

  it('refuses a caller who cannot write the project, before reading storage', async () => {
    canWrite.value = false;

    const result = await createUploadedAudioAssetAction(input());

    expect(result).toEqual({ ok: false, error: 'Project not found' });
    expect(listed).not.toHaveBeenCalled();
    expect(inserted).not.toHaveBeenCalled();
  });

  it.each([
    ['another project', PATH.replace(PROJECT, OTHER)],
    ['another folder', PATH.replace('/audio/', '/covers/')],
    ['the legacy audio-assets key', 'music/1790000000000-theme.mp3'],
    ['traversal', `projects/${PROJECT}/assets/audio/../covers/x.mp3`],
  ])('refuses a key in %s, before reading storage', async (_label, path) => {
    const result = await createUploadedAudioAssetAction(input({ path }));

    expect(result).toEqual({ ok: false, error: 'Upload not found' });
    expect(listed).not.toHaveBeenCalled();
    expect(inserted).not.toHaveBeenCalled();
  });

  it('refuses a key whose file was never stored', async () => {
    const result = await createUploadedAudioAssetAction(
      input({ path: PATH.replace('0a1b2c3d', 'ffffffff') }),
    );

    expect(result).toEqual({ ok: false, error: 'Upload not found' });
    expect(listed).toHaveBeenCalledWith(
      'project-assets',
      `projects/${PROJECT}/assets/audio`,
      '1790000000000-ffffffff.mp3',
    );
    expect(inserted).not.toHaveBeenCalled();
  });

  it('refuses a type the library does not store', async () => {
    const result = await createUploadedAudioAssetAction(
      input({ contentType: 'text/html' }),
    );

    expect(result).toEqual({
      ok: false,
      error: "This file type isn't supported.",
    });
    expect(inserted).not.toHaveBeenCalled();
  });

  it('returns the existing row when the same upload is saved twice', async () => {
    existingRows.value = [
      rowFor({
        project_id: PROJECT,
        audio_type: 'music',
        prompt_hash: 'h',
        prompt: 'Opening theme',
        name: 'Opening theme',
        file_url: 'u',
        file_path: PATH,
        file_size_bytes: 1,
        provider: 'upload',
        status: 'completed',
        metadata: {},
      }),
    ];

    const result = await createUploadedAudioAssetAction(input());

    expect(result).toMatchObject({ ok: true, data: { filePath: PATH } });
    expect(inserted).not.toHaveBeenCalled();
  });

  it('deletes the stored file when the row cannot be saved', async () => {
    insertError.value = {
      message: 'new row violates row-level security policy',
      code: '42501',
    };

    const result = await createUploadedAudioAssetAction(input());

    expect(result).toEqual({
      ok: false,
      error: "Couldn't save this upload.",
    });
    expect(removed).toHaveBeenCalledWith('project-assets', [PATH]);
  });

  describe('R2 provider', () => {
    beforeEach(() => {
      process.env.STORAGE_PROVIDER = 'r2';
      process.env.R2_ACCOUNT_ID = 'test-account';
      process.env.R2_ACCESS_KEY_ID = 'test-key';
      process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
      process.env.R2_BUCKET_NAME = 'test-bucket';
      process.env.R2_PUBLIC_URL = 'https://r2.test';

      const exists = R2StorageAdapter.prototype.exists;
      vi.spyOn(R2StorageAdapter.prototype, 'exists').mockImplementation(
        async function (this: R2StorageAdapter, ...args) {
          (
            this as unknown as { s3Client: { send: typeof r2Send } }
          ).s3Client.send = r2Send;
          return exists.apply(this, args);
        },
      );
      r2Send.mockResolvedValue({});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('checks the project-assets/ key in the one R2 bucket and stores its public URL', async () => {
      const result = await createUploadedAudioAssetAction(input());

      expect(result).toMatchObject({ ok: true });
      const [command] = r2Send.mock.calls[0]!;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: `project-assets/${PATH}`,
      });
      expect(inserted.mock.calls[0]![0]).toMatchObject({
        file_url: `https://r2.test/project-assets/${PATH}`,
      });
    });

    it('refuses when R2 has no such object', async () => {
      r2Send.mockRejectedValue(Object.assign(new Error('NotFound'), {}));

      const result = await createUploadedAudioAssetAction(input());

      expect(result).toEqual({ ok: false, error: 'Upload not found' });
      expect(inserted).not.toHaveBeenCalled();
    });
  });
});
