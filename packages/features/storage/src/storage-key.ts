import 'server-only';

import type { StorageAdapter } from './types';

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

/** Whether `key` lies inside `folder`, read as a folder: `a/b` holds `a/b/c`, not `a/bc` */
function isInFolder(key: string, folder: string) {
  return key.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/**
 * The key behind `url` when this adapter issued it for `bucket` and it lies
 * inside `folder`; otherwise null. What an action may store as a row's file
 * (KB-90) — the same rule `deleteOwnedObject` deletes by, so a row can only
 * ever name a file its own delete may remove.
 */
export function ownedStorageKey(
  storage: StorageAdapter,
  bucket: string,
  url: string,
  folder: string,
): string | null {
  const key = storageKeyFromPublicUrl(storage, bucket, url);

  return key && isInFolder(key, folder) ? key : null;
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

  if (!isInFolder(key, ownPrefix)) {
    return { deleted: false, reason: 'outside-prefix' };
  }

  try {
    await storage.delete(bucket, key);

    return { deleted: true, key };
  } catch (error) {
    return { deleted: false, reason: 'delete-failed', error };
  }
}
