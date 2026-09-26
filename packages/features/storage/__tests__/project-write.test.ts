import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '../src/types';

vi.mock('server-only', () => ({}));

const send = vi.fn();

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  return {
    ...actual,
    S3Client: vi.fn(() => ({ send })),
  };
});

/**
 * KB-57: R2 has no storage policies, so the project check has to run in the
 * server before any byte is written. There is no local R2: these run the
 * gate against the adapter test double, and against the real R2 adapter
 * with its S3 client replaced, to show a refused key never reaches R2.
 */

const PROJECT = '11111111-5700-4000-8000-000000000001';
const KEY = `projects/${PROJECT}/sfx/asset.mp3`;

function rpcClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  return { rpc: vi.fn(async () => result) };
}

function adapterDouble(): StorageAdapter {
  return {
    upload: vi.fn(async (bucket: string, path: string) => ({
      path,
      url: `https://cdn.test/${bucket}/${path}`,
    })),
    getSignedUploadUrl: vi.fn(),
    getPublicUrl: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    read: vi.fn(),
  };
}

const BODY = Buffer.from('audio');
const OPTIONS = { contentType: 'audio/mpeg' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('writeProjectObject', () => {
  it('asks can_write_project_storage about the key, then uploads it', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const client = rpcClient({ data: true, error: null });
    const storage = adapterDouble();

    const result = await writeProjectObject(
      client,
      storage,
      'audio',
      KEY,
      BODY,
      OPTIONS,
    );

    expect(client.rpc).toHaveBeenCalledWith('can_write_project_storage', {
      path: KEY,
    });
    expect(storage.upload).toHaveBeenCalledExactlyOnceWith(
      'audio',
      KEY,
      BODY,
      OPTIONS,
    );
    expect(result.url).toBe(`https://cdn.test/audio/${KEY}`);
  });

  it('refuses a key the caller cannot write, and writes nothing', async () => {
    const { StorageWriteRefused, writeProjectObject } = await import(
      '../src/project-write'
    );
    const storage = adapterDouble();

    await expect(
      writeProjectObject(
        rpcClient({ data: false, error: null }),
        storage,
        'audio',
        KEY,
        BODY,
        OPTIONS,
      ),
    ).rejects.toBeInstanceOf(StorageWriteRefused);
    await expect(
      writeProjectObject(
        rpcClient({ data: false, error: null }),
        storage,
        'audio',
        KEY,
        BODY,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ key: KEY, reason: 'not-writer' });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('refuses a key that names no project without asking the database', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const client = rpcClient({ data: true, error: null });
    const storage = adapterDouble();

    await expect(
      writeProjectObject(
        client,
        storage,
        'audio-assets',
        'music/asset.mp3',
        BODY,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ reason: 'no-scope' });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('fails closed when the check itself fails', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const storage = adapterDouble();

    await expect(
      writeProjectObject(
        rpcClient({ data: null, error: { message: 'connection reset' } }),
        storage,
        'audio',
        KEY,
        BODY,
        OPTIONS,
      ),
    ).rejects.toThrow('connection reset');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('treats anything but true as a refusal', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const storage = adapterDouble();

    await expect(
      writeProjectObject(
        rpcClient({ data: null, error: null }),
        storage,
        'audio',
        KEY,
        BODY,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ reason: 'not-writer' });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('on the R2 adapter', () => {
  function r2() {
    return import('../src/adapters/r2').then(
      ({ R2StorageAdapter }) =>
        new R2StorageAdapter({
          accountId: 'test',
          accessKeyId: 'test',
          secretAccessKey: 'test',
          bucketName: 'test-bucket',
          publicUrl: 'https://cdn.test',
        }),
    );
  }

  it('a refused key never reaches R2', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const storage = await r2();

    await expect(
      writeProjectObject(
        rpcClient({ data: false, error: null }),
        storage,
        'audio',
        KEY,
        BODY,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ reason: 'not-writer' });
    expect(send).not.toHaveBeenCalled();
  });

  it('an allowed key is put at <bucket>/<key>', async () => {
    const { writeProjectObject } = await import('../src/project-write');
    const storage = await r2();

    await writeProjectObject(
      rpcClient({ data: true, error: null }),
      storage,
      'audio',
      KEY,
      BODY,
      OPTIONS,
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: `audio/${KEY}`,
    });
  });
});

describe('canWriteProjectKey', () => {
  it('is false for a key with no project, without a query', async () => {
    const { canWriteProjectKey } = await import('../src/project-write');
    const client = rpcClient({ data: true, error: null });

    await expect(canWriteProjectKey(client, 'temp/user/1.mp3')).resolves.toBe(
      false,
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
