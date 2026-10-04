import { describe, expect, it, vi } from 'vitest';

import { B2StorageAdapter } from '../src/adapters/b2';
import { R2StorageAdapter } from '../src/adapters/r2';
import { SupabaseStorageAdapter } from '../src/adapters/supabase';

vi.mock('server-only', () => ({}));

/**
 * FILM-2001: the desktop downloads an episode's media over signed GETs, so
 * nothing it pulls depends on a public bucket. Dummy credentials: signing
 * is local, nothing is sent. The real round trip (a GET inside the TTL, a
 * 403 after it) is `signed-read.s3-local.test.ts`.
 */

const PATH =
  'projects/11111111-2001-4000-8000-000000000001/shots/22222222-2001-4000-8000-000000000002/video/shot.mp4';

function r2() {
  return new R2StorageAdapter({
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucketName: 'test-bucket',
    publicUrl: 'https://r2.test',
  });
}

function b2() {
  return new B2StorageAdapter({
    keyId: 'test-key',
    applicationKey: 'test-secret',
    bucketName: 'test-bucket',
    endpoint: 's3.test-region.backblazeb2.com',
    publicUrl: 'https://b2.test',
  });
}

describe.each([
  ['R2', r2],
  ['B2', b2],
] as const)('%s signed read URL', (_name, make) => {
  it('is a GET for the bucket-prefixed key that expires when asked', async () => {
    const url = new URL(
      await make().getSignedReadUrl('project-assets', PATH, 3600),
    );

    // Virtual-hosted style: the bucket is the host's first label.
    expect(url.hostname.startsWith('test-bucket.')).toBe(true);
    expect(decodeURIComponent(url.pathname)).toBe(`/project-assets/${PATH}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs nothing a plain GET would have to send', async () => {
    const url = new URL(
      await make().getSignedReadUrl('project-assets', PATH, 60),
    );

    // Only the host: a downloader sending Range or no headers still matches.
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
  });
});

describe('R2 stat', () => {
  function withSend(send: (command: unknown) => Promise<unknown>) {
    const adapter = r2();
    (adapter as unknown as { s3Client: { send: typeof send } }).s3Client = {
      send,
    };
    return adapter;
  }

  it('returns size and type from a HEAD', async () => {
    const adapter = withSend(async () => ({
      ContentLength: 48211,
      ContentType: 'video/mp4',
    }));

    expect(await adapter.stat('project-assets', PATH)).toEqual({
      bytes: 48211,
      contentType: 'video/mp4',
    });
  });

  it('returns null for a missing object', async () => {
    const adapter = withSend(async () => {
      throw Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
    });

    expect(await adapter.stat('project-assets', PATH)).toBeNull();
  });

  it('throws when the store cannot be asked, rather than saying missing', async () => {
    const adapter = withSend(async () => {
      throw Object.assign(new Error('socket hang up'), {
        $metadata: { httpStatusCode: 503 },
      });
    });

    await expect(adapter.stat('project-assets', PATH)).rejects.toThrow(
      'socket hang up',
    );
  });
});

describe('Supabase signed read URL and stat', () => {
  function supabase(bucketApi: Record<string, unknown>) {
    const from = vi.fn(() => bucketApi);
    const adapter = new SupabaseStorageAdapter({
      storage: { from },
    } as never);
    return { adapter, from };
  }

  it('asks Storage for a URL with the TTL, as the client’s role', async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'http://127.0.0.1:55321/storage/v1/object/sign/x' },
      error: null,
    }));
    const { adapter, from } = supabase({ createSignedUrl });

    await expect(
      adapter.getSignedReadUrl('project-assets', PATH, 3600),
    ).resolves.toBe('http://127.0.0.1:55321/storage/v1/object/sign/x');
    expect(from).toHaveBeenCalledWith('project-assets');
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 3600);
  });

  it('throws when Storage refuses, never returning a broken URL', async () => {
    const { adapter } = supabase({
      createSignedUrl: async () => ({
        data: null,
        error: new Error('Object not found'),
      }),
    });

    await expect(
      adapter.getSignedReadUrl('project-assets', PATH, 3600),
    ).rejects.toThrow('Failed to create signed read URL');
  });

  it('stat reads size and type, and a 404 is null', async () => {
    const found = supabase({
      info: async () => ({
        data: { size: 1200, contentType: 'audio/mpeg' },
        error: null,
      }),
    });
    const missing = supabase({
      info: async () => ({
        data: null,
        error: Object.assign(new Error('Object not found'), { status: 404 }),
      }),
    });

    expect(await found.adapter.stat('audio', PATH)).toEqual({
      bytes: 1200,
      contentType: 'audio/mpeg',
    });
    expect(await missing.adapter.stat('audio', PATH)).toBeNull();
  });
});
