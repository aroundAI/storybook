import { createHash } from 'node:crypto';

import type { StorageAdapter } from '@kit/storage';

import {
  buildEditPackage,
  collectMediaUrls,
  editPackageEtag,
} from '../../src/build-edit-package';
import {
  EDIT_PACKAGE_URL_TTL_SECONDS,
  type EditPackage,
  type MediaEntry,
} from '../../src/edit-package.schema';
import { analyticsHintsFrom } from '../../src/retention-hints';
import { resolveMedia } from '../../src/server/resolve-media';
import {
  FIXTURE_GENERATED_AT,
  FIXTURE_PUBLIC_PREFIX,
  type FixtureSeed,
} from './seed';

/**
 * A storage adapter for the fixtures: public URLs in local Supabase's shape,
 * sizes derived from the key, and "signed" URLs with an R2 presigned GET's
 * parameters and length but a signature derived from the key, so they are
 * stable. Nothing is fetched or signed.
 */
export function fixtureStorage(
  missingKeys: ReadonlySet<string>,
): StorageAdapter {
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const refused = () => {
    throw new Error('fixture storage is read-only');
  };

  return {
    getPublicUrl: (bucket, path) =>
      `${FIXTURE_PUBLIC_PREFIX}/${bucket}/${path}`,
    async stat(bucket, path) {
      const key = `${bucket}/${path}`;

      if (missingKeys.has(key)) return null;

      const base = path.endsWith('.mp4')
        ? 2_000_000
        : path.endsWith('.mp3')
          ? 24_000
          : 180_000;

      return {
        bytes: base + (parseInt(digest(key).slice(0, 4), 16) % 1000),
        contentType: null,
      };
    },
    async getSignedReadUrl(bucket, path, expiresIn) {
      const key = `${bucket}/${path}`;

      return `https://storybook-media.r2.example.test/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=FIXTUREKEY%2F20261004%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261004T120000Z&X-Amz-Expires=${expiresIn}&X-Amz-Signature=${digest(key)}&X-Amz-SignedHeaders=host&x-id=GetObject`;
    },
    upload: refused,
    getSignedUploadUrl: refused,
    delete: refused,
    exists: async () => true,
    read: async () => null,
  };
}

/** The fixture package for a seed: the real resolver and builder, fake storage. */
export async function buildFixturePackage(
  seed: FixtureSeed,
): Promise<EditPackage> {
  const { sources } = seed;
  const resolved = await resolveMedia(collectMediaUrls(sources), {
    storage: fixtureStorage(seed.missingKeys),
    projectId: sources.project.id,
    episodeId: sources.episode.id,
    audioAssetIds: new Set(sources.audioAssets.map((a) => a.id)),
    recordedHashes: sources.recordedHashes,
    ttlSeconds: EDIT_PACKAGE_URL_TTL_SECONDS,
    concurrency: 1,
  });

  return buildEditPackage({
    sources,
    media: (url): MediaEntry =>
      url ? resolved.get(url)! : { url: null, mediaReason: 'not_generated' },
    analyticsHints: analyticsHintsFrom(seed.retention),
    generatedAt: FIXTURE_GENERATED_AT,
    etag: editPackageEtag(sources),
  });
}
