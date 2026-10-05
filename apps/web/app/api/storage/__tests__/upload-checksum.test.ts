import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-189: a browser upload is PUT straight to storage, so its SHA-256 is
 * computed in the browser and reported to /api/storage/checksum, which
 * records it for the edit package once it has checked what it cheaply can:
 * the caller writes the key, and the stored object has the reported size.
 *
 * The real route runs. The caller's client answers the write check, the
 * storage adapter answers the HEAD, and the service-role client records.
 */

const PROJECT = '18900000-0000-4000-8000-000000000001';
const SHOT = '18900000-0000-4000-8000-0000000000a1';
const PATH = `projects/${PROJECT}/shots/${SHOT}/video/1700000000000-take.mp4`;
const BYTES = Buffer.from('a shot video');
const SHA = createHash('sha256').update(BYTES).digest('hex');

const state = vi.hoisted(() => ({
  writable: true,
  stored: null as { bytes: number; contentType: string | null } | null,
  recorded: [] as Array<Record<string, unknown>>,
  stats: [] as string[],
}));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler:
    (handler: (args: unknown) => unknown) => (request: Request) =>
      handler({ request, user: { id: 'user-1' } }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: () => undefined, error: () => undefined }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    rpc: async (fn: string) =>
      fn === 'can_write_project_storage'
        ? { data: state.writable, error: null }
        : { data: null, error: { message: `unexpected rpc ${fn}` } },
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.recorded.push({ fn, ...args });
      return { error: null };
    },
  }),
}));

vi.mock('@kit/storage', async () => {
  const { canWriteProjectKey } = await import(
    '../../../../../../packages/features/storage/src/project-write'
  );

  return {
    canWriteProjectKey,
    getStorageAdapter: () => ({
      stat: async (bucket: string, path: string) => {
        state.stats.push(`${bucket}/${path}`);
        return state.stored;
      },
    }),
  };
});

vi.mock('server-only', () => ({}));

async function post(body: Record<string, unknown>) {
  const { POST } = await import('../checksum/route');
  const response = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('https://app.test/api/storage/checksum', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return { status: response.status, body: await response.json() };
}

const valid = {
  bucket: 'project-assets',
  path: PATH,
  sha256: SHA,
  size: BYTES.length,
};

beforeEach(() => {
  state.writable = true;
  state.stored = { bytes: BYTES.length, contentType: 'video/mp4' };
  state.recorded = [];
  state.stats = [];
});

describe('POST /api/storage/checksum', () => {
  it('records the SHA-256 and size of a writer’s stored upload', async () => {
    await expect(post(valid)).resolves.toEqual({
      status: 200,
      body: { recorded: true },
    });
    expect(state.recorded).toEqual([
      {
        fn: 'record_media_checksum',
        p_bucket: 'project-assets',
        p_key: PATH,
        p_sha256: SHA,
        p_bytes: BYTES.length,
      },
    ]);
  });

  it('refuses a caller who cannot write the key, before looking at storage', async () => {
    state.writable = false;

    expect((await post(valid)).status).toBe(403);
    expect(state.stats).toEqual([]);
    expect(state.recorded).toEqual([]);
  });

  it('refuses when the stored object is another size than the file hashed', async () => {
    state.stored = { bytes: BYTES.length - 1, contentType: 'video/mp4' };

    expect((await post(valid)).status).toBe(409);
    expect(state.recorded).toEqual([]);
  });

  it('refuses when nothing is stored at the key', async () => {
    state.stored = null;

    expect((await post(valid)).status).toBe(404);
    expect(state.recorded).toEqual([]);
  });

  it.each([
    ['another bucket', { bucket: 'account_image' }],
    ['a path no uploader writes', { path: `projects/${PROJECT}/../x.mp4` }],
    ['a hash that is not a SHA-256', { sha256: 'abc' }],
  ])('refuses %s', async (_label, change) => {
    expect((await post({ ...valid, ...change })).status).toBe(400);
    expect(state.recorded).toEqual([]);
  });
});
