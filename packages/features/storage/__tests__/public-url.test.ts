import { createClient } from '@supabase/supabase-js';

import { describe, expect, it, vi } from 'vitest';

import { R2StorageAdapter } from '../src/adapters/r2';
import { SupabaseStorageAdapter } from '../src/adapters/supabase';
import {
  keyUnderPrefix,
  ownedPublicKey,
  publicUrlPrefix,
} from '../src/public-url';

vi.mock('server-only', () => ({}));

/**
 * KB-104. The publish worker checks a thumbnail is the app's own with no
 * adapter to ask, so it reads the public-URL prefix from the environment.
 * That prefix must be the one each adapter actually issues, or the worker
 * would refuse the app's own files (or accept another bucket's).
 */

const BUCKET = 'project-assets';
const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
const R2_PUBLIC_URL = 'https://cdn.example.com';
const FOLDER = 'episodes/00000000-0000-4000-8000-0000000000e1/thumbnails/';

const R2_ENV = {
  STORAGE_PROVIDER: 'r2',
  R2_PUBLIC_URL,
  R2_ACCOUNT_ID: 'a',
  R2_ACCESS_KEY_ID: 'k',
  R2_SECRET_ACCESS_KEY: 's',
  R2_BUCKET_NAME: 'b',
};

describe('publicUrlPrefix matches what each adapter issues', () => {
  it('Supabase', () => {
    const adapter = new SupabaseStorageAdapter(
      createClient(SUPABASE_URL, 'anon-key'),
    );

    expect(
      publicUrlPrefix(BUCKET, { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL }),
    ).toBe(adapter.getPublicUrl(BUCKET, ''));
  });

  it('R2', () => {
    const adapter = new R2StorageAdapter({
      accountId: 'a',
      accessKeyId: 'k',
      secretAccessKey: 's',
      bucketName: 'b',
      publicUrl: R2_PUBLIC_URL,
    });

    expect(publicUrlPrefix(BUCKET, R2_ENV)).toBe(
      `${adapter.getPublicUrl(BUCKET, '')}`,
    );
  });

  it('is null when the environment does not say, so nothing is recognised', () => {
    expect(publicUrlPrefix(BUCKET, { STORAGE_PROVIDER: 'r2' })).toBeNull();
    expect(publicUrlPrefix(BUCKET, {})).toBeNull();
  });
});

describe('ownedPublicKey', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL };
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

  it("accepts the app's own upload in the folder", () => {
    expect(
      ownedPublicKey(BUCKET, `${prefix}${FOLDER}en-1.png?v=2`, FOLDER, env),
    ).toBe(`${FOLDER}en-1.png`);
  });

  it.each([
    ['another folder', `${prefix}episodes/other/thumbnails/en-1.png`],
    [
      'another host',
      `https://attacker.supabase.co/storage/v1/object/public/${BUCKET}/${FOLDER}x.png`,
    ],
    [
      'another host of the same length',
      `https://zzzzzzzzzzzzzzzz.supabase.co/storage/v1/object/public/${BUCKET}/${FOLDER}x.png`,
    ],
    [
      'another bucket',
      `${SUPABASE_URL}/storage/v1/object/public/other/${FOLDER}x.png`,
    ],
    ['a climb out of the folder', `${prefix}${FOLDER}../../other/x.png`],
    ['an empty segment', `${prefix}${FOLDER}/x.png`],
  ])('refuses %s', (_label, url) => {
    expect(ownedPublicKey(BUCKET, url, FOLDER, env)).toBeNull();
  });

  it('refuses everything when the prefix is unknown', () => {
    expect(
      ownedPublicKey(BUCKET, `${prefix}${FOLDER}en-1.png`, FOLDER, {
        STORAGE_PROVIDER: 'r2',
      }),
    ).toBeNull();
  });

  it('keyUnderPrefix reads a key only under the exact prefix', () => {
    expect(keyUnderPrefix(prefix, `${prefix}a/b.png`)).toBe('a/b.png');
    expect(
      keyUnderPrefix(prefix, `${prefix.slice(0, -1)}x/a/b.png`),
    ).toBeNull();
  });
});
