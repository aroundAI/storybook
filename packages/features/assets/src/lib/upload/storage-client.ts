import 'server-only';

/**
 * Minimal Supabase client interface for storage operations
 * This avoids a direct dependency on @supabase/supabase-js
 */
interface StorageClient {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        data: Buffer,
        options?: {
          contentType?: string;
          cacheControl?: string;
          upsert?: boolean;
        },
      ) => Promise<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
      remove: (
        paths: string[],
      ) => Promise<{ error: { message: string } | null }>;
    };
    getBucket: (name: string) => Promise<{
      data: unknown;
      error: unknown;
    }>;
  };
}

/**
 * Storage bucket for project assets
 */
export const PROJECT_ASSETS_BUCKET = 'project-assets';

/**
 * Result of an upload operation
 */
export interface UploadResult {
  path: string;
  url: string;
}

/**
 * Options for uploading a file
 */
export interface UploadOptions {
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadToStorage(
  client: StorageClient,
  bucket: string,
  path: string,
  buffer: Buffer,
  options: UploadOptions,
): Promise<UploadResult> {
  const { error } = await client.storage.from(bucket).upload(path, buffer, {
    contentType: options.contentType,
    cacheControl: options.cacheControl ?? '3600',
    upsert: options.upsert ?? false,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const url = getPublicUrl(client, bucket, path);

  return { path, url };
}

/**
 * Get the public URL for a file in storage
 */
export function getPublicUrl(
  client: StorageClient,
  bucket: string,
  path: string,
): string {
  const {
    data: { publicUrl },
  } = client.storage.from(bucket).getPublicUrl(path);

  return publicUrl;
}

/**
 * Delete a file from storage
 */
export async function deleteFromStorage(
  client: StorageClient,
  bucket: string,
  path: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).remove([path]);

  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Check if a bucket exists (for initialization)
 */
export async function bucketExists(
  client: StorageClient,
  bucket: string,
): Promise<boolean> {
  const { data, error } = await client.storage.getBucket(bucket);

  if (error) {
    return false;
  }

  return !!data;
}
