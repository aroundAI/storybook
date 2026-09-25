import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type UploadOptions as AdapterUploadOptions,
  type UploadResult as AdapterUploadResult,
  type StorageAdapter,
  getStorageAdapter,
} from '@kit/storage';

// Writes go through `writeProjectObject` in `@kit/storage` (KB-57); this
// module reads, deletes and builds URLs.

/**
 * Storage bucket for project assets
 */
export const PROJECT_ASSETS_BUCKET = 'project-assets';

/**
 * Result of an upload operation
 */
export type UploadResult = AdapterUploadResult;

/**
 * Options for uploading a file
 */
export type UploadOptions = AdapterUploadOptions;

/**
 * Legacy Supabase client interface for backward compatibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StorageClient = SupabaseClient<any, any, any>;

/**
 * Cache for storage adapter instance
 */
let cachedAdapter: StorageAdapter | null = null;

/**
 * Get the storage adapter (with caching)
 */
function getAdapter(client?: StorageClient): StorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  cachedAdapter = getStorageAdapter(client);
  return cachedAdapter;
}

/**
 * Get the public URL for a file in storage
 */
export function getPublicUrl(
  client: StorageClient,
  bucket: string,
  path: string,
): string {
  const adapter = getAdapter(client);
  return adapter.getPublicUrl(bucket, path);
}

/**
 * Delete a file from storage
 */
export async function deleteFromStorage(
  client: StorageClient,
  bucket: string,
  path: string,
): Promise<void> {
  const adapter = getAdapter(client);
  return adapter.delete(bucket, path);
}

/**
 * Check if a file exists in storage
 */
export async function existsInStorage(
  client: StorageClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const adapter = getAdapter(client);
  return adapter.exists(bucket, path);
}

/**
 * Read a file from storage
 */
export async function readFromStorage(
  client: StorageClient,
  bucket: string,
  path: string,
): Promise<Buffer | null> {
  const adapter = getAdapter(client);
  return adapter.read(bucket, path);
}

/**
 * Check if a bucket exists (for initialization)
 * Legacy function - kept for backward compatibility
 */
export async function bucketExists(
  client: StorageClient,
  bucket: string,
): Promise<boolean> {
  // For local storage, bucket always "exists" (directories are created on demand)
  if (process.env.STORAGE_PROVIDER === 'local') {
    return true;
  }

  // For Supabase, check using the client directly
  const { data, error } = await client.storage.getBucket(bucket);

  if (error) {
    return false;
  }

  return !!data;
}
