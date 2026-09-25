import { createClient } from '@supabase/supabase-js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { R2StorageAdapter } from '../src/adapters/r2';
import { SupabaseStorageAdapter } from '../src/adapters/supabase';
import {
  deleteOwnedObject,
  ownedStorageKey,
  storageKeyFromPublicUrl,
} from '../src/storage-key';
import type { StorageAdapter } from '../src/types';

vi.mock('server-only', () => ({}));

/**
 * KB-54: the intro and thumbnail actions turned a stored public URL back into
 * an object key with `pathname.split('/').slice(-2)`, which drops the
 * `projects/<P>/` or `episodes/<E>/` prefix, so every best-effort delete
 * removed nothing. The key is now read against the adapter's own public-URL
 * prefix, and a delete is confined to the row's own folder: on R2 the delete
 * runs with the app's credentials, so a URL a writer supplied must not be
 * able to name another project's file.
 */

const PROJECT = '11111111-5400-4000-8000-000000000001';
const OTHER = '11111111-5400-4000-8000-000000000002';
const KEY = `projects/${PROJECT}/assets/intros/en-1790000000000.mp4`;

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const PROVIDERS = ['supabase', 'r2'] as const;

function adapter(name: (typeof PROVIDERS)[number]): StorageAdapter {
  return name === 'supabase'
    ? new SupabaseStorageAdapter(
        createClient('http://127.0.0.1:54321', 'anon-key'),
      )
    : new R2StorageAdapter();
}

describe('storageKeyFromPublicUrl', () => {
  it.each(PROVIDERS)(
    '%s: reads back the key of a URL the adapter issued',
    (name) => {
      const storage = adapter(name);
      const url = storage.getPublicUrl('project-assets', KEY);

      expect(storageKeyFromPublicUrl(storage, 'project-assets', url)).toBe(KEY);
    },
  );

  it.each(PROVIDERS)('%s: ignores a cache-busting query', (name) => {
    const storage = adapter(name);
    const url = `${storage.getPublicUrl('project-assets', KEY)}?v=123`;

    expect(storageKeyFromPublicUrl(storage, 'project-assets', url)).toBe(KEY);
  });

  it.each(PROVIDERS)(
    '%s: returns null for a URL on another host or bucket',
    (name) => {
      const storage = adapter(name);
      expect(
        storageKeyFromPublicUrl(
          storage,
          'project-assets',
          `https://elsewhere.test/project-assets/${KEY}`,
        ),
      ).toBeNull();
      expect(
        storageKeyFromPublicUrl(
          storage,
          'project-assets',
          storage.getPublicUrl('account_image', KEY),
        ),
      ).toBeNull();
    },
  );

  it.each(PROVIDERS)('%s: refuses a key with ..', (name) => {
    const storage = adapter(name);
    const url = storage.getPublicUrl(
      'project-assets',
      `projects/${PROJECT}/../${OTHER}/x.mp4`,
    );

    expect(storageKeyFromPublicUrl(storage, 'project-assets', url)).toBeNull();
  });

  it('returns null rather than throwing on garbage', () => {
    const storage = adapter('r2');

    expect(
      storageKeyFromPublicUrl(storage, 'project-assets', 'not a url'),
    ).toBeNull();
  });
});

// KB-90: what the intro and thumbnail actions will store — only a file this
// adapter issued, inside the row's own folder. The same rule as the delete.
describe('ownedStorageKey', () => {
  const FOLDER = `projects/${PROJECT}/assets/intros/`;

  it.each(PROVIDERS)('%s: accepts an upload in the folder', (name) => {
    const storage = adapter(name);
    const url = storage.getPublicUrl('project-assets', KEY);

    expect(ownedStorageKey(storage, 'project-assets', url, FOLDER)).toBe(KEY);
    expect(
      ownedStorageKey(storage, 'project-assets', `${url}?v=123`, FOLDER),
    ).toBe(KEY);
  });

  it.each(PROVIDERS)('%s: refuses anything else', (name) => {
    const storage = adapter(name);
    const own = (key: string) => storage.getPublicUrl('project-assets', key);

    for (const url of [
      'https://attacker.example/page.html',
      own(`projects/${OTHER}/assets/intros/en-1.mp4`),
      own(`projects/${PROJECT}/assets/covers/cover-1.png`),
      own(`projects/${PROJECT}/assets/intros`),
      storage.getPublicUrl('account_image', KEY),
    ]) {
      expect(
        ownedStorageKey(storage, 'project-assets', url, FOLDER),
      ).toBeNull();
    }
  });

  it('treats the folder as a folder: one id is not a prefix of another', () => {
    const storage = adapter('r2');
    const url = storage.getPublicUrl(
      'project-assets',
      `projects/${PROJECT}0/assets/intros/en-1.mp4`,
    );

    expect(
      ownedStorageKey(storage, 'project-assets', url, `projects/${PROJECT}`),
    ).toBeNull();
  });
});

describe('deleteOwnedObject', () => {
  function fakeStorage(prefix = 'https://cdn.example.com') {
    const deleted: string[] = [];
    const storage = {
      getPublicUrl: (bucket: string, path: string) =>
        `${prefix}/${bucket}/${path}`,
      delete: vi.fn(async (_bucket: string, path: string) => {
        deleted.push(path);
      }),
    } as unknown as StorageAdapter;

    return { storage, deleted };
  }

  it('deletes the full key when it is inside the owner folder', async () => {
    const { storage, deleted } = fakeStorage();

    const result = await deleteOwnedObject(
      storage,
      'project-assets',
      `https://cdn.example.com/project-assets/${KEY}`,
      `projects/${PROJECT}/`,
    );

    expect(result).toEqual({ deleted: true, key: KEY });
    expect(deleted).toEqual([KEY]);
  });

  it("does not delete another project's file", async () => {
    const { storage, deleted } = fakeStorage();
    const foreign = `projects/${OTHER}/assets/intros/en-1.mp4`;

    const result = await deleteOwnedObject(
      storage,
      'project-assets',
      `https://cdn.example.com/project-assets/${foreign}`,
      `projects/${PROJECT}/`,
    );

    expect(result).toEqual({ deleted: false, reason: 'outside-prefix' });
    expect(deleted).toEqual([]);
  });

  it('does not delete a URL the adapter did not issue', async () => {
    const { storage, deleted } = fakeStorage();

    const result = await deleteOwnedObject(
      storage,
      'project-assets',
      `https://elsewhere.test/project-assets/${KEY}`,
      `projects/${PROJECT}/`,
    );

    expect(result).toEqual({ deleted: false, reason: 'foreign-url' });
    expect(deleted).toEqual([]);
  });

  it('reports a storage failure instead of throwing', async () => {
    const { storage } = fakeStorage();
    vi.mocked(storage.delete).mockRejectedValueOnce(new Error('boom'));

    const result = await deleteOwnedObject(
      storage,
      'project-assets',
      `https://cdn.example.com/project-assets/${KEY}`,
      `projects/${PROJECT}/`,
    );

    expect(result).toMatchObject({ deleted: false, reason: 'delete-failed' });
  });
});
