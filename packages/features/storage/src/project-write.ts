import 'server-only';

import { type MediaChecksumClient, recordWrittenMedia } from './media-checksum';
import type { StorageAdapter, UploadOptions, UploadResult } from './types';
import { storageKeyScope } from './upload-paths';

/**
 * The one project check for server-side storage writes (KB-57).
 *
 * On Supabase every project bucket's policies run
 * `can_write_project_storage(name)`. R2 has no policies, and the app writes
 * it with its own credentials, so without this nothing below an action ties
 * the key it writes to the project it checked. The gate asks the same
 * function, as the caller, about the key itself, so both providers apply one
 * rule. It runs before the adapter is touched and fails closed.
 */

/** A client that can ask the database, as the signed-in caller */
export interface ProjectKeyClient {
  rpc(
    fn: 'can_write_project_storage',
    args: { path: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export class StorageWriteRefused extends Error {
  constructor(
    readonly key: string,
    readonly reason: 'no-scope' | 'not-writer',
  ) {
    super(
      reason === 'no-scope'
        ? `Storage key names no project: ${key}`
        : `Caller cannot write storage key: ${key}`,
    );
    this.name = 'StorageWriteRefused';
  }
}

/**
 * Whether the caller may write `key`: an owner, admin or member of the
 * project it names (KB-28's rule). A key naming no project is false without
 * a query. Throws when the check cannot be made.
 */
export async function canWriteProjectKey(
  client: ProjectKeyClient,
  key: string,
): Promise<boolean> {
  if (!storageKeyScope(key)) return false;

  const { data, error } = await client.rpc('can_write_project_storage', {
    path: key,
  });

  if (error) {
    throw new Error(`can_write_project_storage failed: ${error.message}`);
  }

  return data === true;
}

/**
 * Upload `data` at `key`, once the caller is known to write the project the
 * key names. `storage` may run on the service role: `audio-assets` takes no
 * user writes, and this check is the policy's own. The bytes' SHA-256 is
 * recorded through `checksums`, a service-role client (KB-189).
 */
export async function writeProjectObject(
  client: ProjectKeyClient,
  storage: StorageAdapter,
  bucket: string,
  key: string,
  data: Buffer,
  options: UploadOptions,
  checksums: MediaChecksumClient,
): Promise<UploadResult> {
  if (!storageKeyScope(key)) {
    throw new StorageWriteRefused(key, 'no-scope');
  }

  if (!(await canWriteProjectKey(client, key))) {
    throw new StorageWriteRefused(key, 'not-writer');
  }

  const result = await storage.upload(bucket, key, data, options);

  await recordWrittenMedia(checksums, bucket, key, data);

  return result;
}
