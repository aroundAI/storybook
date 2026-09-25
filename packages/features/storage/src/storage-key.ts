import 'server-only';

import { STORAGE_BUCKETS } from './buckets';
import type { StorageAdapter } from './types';
import { isAudioLibraryPath } from './upload-paths';

/**
 * The object key behind a public URL this adapter issued for `bucket`, or
 * null when the URL is not one of them (another host, another bucket, another
 * provider, or a key holding `..`).
 *
 * The prefix is the adapter's own `getPublicUrl(bucket, '')`, so the answer
 * is exact on every provider. KB-54 derived the key with
 * `pathname.split('/').slice(-2)`, which dropped the `projects/<P>/` prefix
 * and so deleted nothing.
 */
export function storageKeyFromPublicUrl(
  storage: StorageAdapter,
  bucket: string,
  url: string,
): string | null {
  try {
    const base = storage.getPublicUrl(bucket, '');
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const withoutQuery = url.split(/[?#]/)[0] ?? '';

    if (!withoutQuery.startsWith(prefix)) {
      return null;
    }

    const key = decodeURI(withoutQuery.slice(prefix.length));

    if (!key || key.split('/').some((part) => part === '' || part === '..')) {
      return null;
    }

    return key;
  } catch {
    return null;
  }
}

export type OwnedDeleteResult =
  | { deleted: true; key: string }
  | {
      deleted: false;
      reason: 'foreign-url' | 'outside-prefix' | 'delete-failed';
      error?: unknown;
    };

/**
 * Best-effort delete of the object behind `url`, only if its key lies under
 * `ownPrefix` (e.g. `projects/<projectId>/`). On R2 a delete runs with the
 * app's own credentials, so a stored URL — which a writer supplied — must
 * not be able to name another project's file. Never throws.
 */
export async function deleteOwnedObject(
  storage: StorageAdapter,
  bucket: string,
  url: string,
  ownPrefix: string,
): Promise<OwnedDeleteResult> {
  const key = storageKeyFromPublicUrl(storage, bucket, url);

  if (!key) {
    return { deleted: false, reason: 'foreign-url' };
  }

  const folder = ownPrefix.endsWith('/') ? ownPrefix : `${ownPrefix}/`;

  if (!key.startsWith(folder)) {
    return { deleted: false, reason: 'outside-prefix' };
  }

  try {
    await storage.delete(bucket, key);

    return { deleted: true, key };
  } catch (error) {
    return { deleted: false, reason: 'delete-failed', error };
  }
}

/**
 * Where an audio-library asset's own file is, or null if its URL points
 * anywhere else (KB-95).
 *
 * A project writer can rewrite `file_url` on the row, and the file is
 * deleted with the app's own credentials, so the URL never chooses the key
 * by itself: the key must be exactly one of the places this asset, by its
 * own id and project, is stored. That is an upload (KB-73) or one of the
 * three generated layouts.
 */
export function ownedAudioAssetLocation(
  storage: StorageAdapter,
  asset: { id: string; project_id: string; file_url: string | null },
): { bucket: string; key: string } | null {
  if (!asset.file_url) return null;

  const { id, project_id: projectId } = asset;
  const owned: Array<[string, (key: string) => boolean]> = [
    [
      STORAGE_BUCKETS.projectAssets,
      (key) => isAudioLibraryPath(projectId, key),
    ],
    [
      STORAGE_BUCKETS.audioAssets,
      (key) => key === `music/${id}.mp3` || key === `sfx/${id}.mp3`,
    ],
    [
      STORAGE_BUCKETS.audio,
      (key) =>
        ['music', 'sfx', 'ambient'].some(
          (folder) => key === `${projectId}/${folder}/${id}.mp3`,
        ),
    ],
  ];

  for (const [bucket, isOwn] of owned) {
    const key = storageKeyFromPublicUrl(storage, bucket, asset.file_url);

    if (key && isOwn(key)) {
      return { bucket, key };
    }
  }

  return null;
}
