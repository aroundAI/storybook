/**
 * Supabase Storage Adapter
 *
 * Wraps Supabase Storage for cloud-based file storage.
 * Used in production for multi-tenant SaaS deployments.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  SignedUploadRequest,
  SignedUploadResult,
  StorageAdapter,
  StoredObjectInfo,
  UploadOptions,
  UploadResult,
} from '../types';

/**
 * Generic Supabase client type to avoid strict typing issues
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export class SupabaseStorageAdapter implements StorageAdapter {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async upload(
    bucket: string,
    path: string,
    data: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, data, {
        contentType: options.contentType,
        cacheControl: options.cacheControl ?? '3600',
        upsert: options.upsert ?? false,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const url = this.getPublicUrl(bucket, path);

    return { path, url };
  }

  async getSignedUploadUrl(
    bucket: string,
    path: string,
    { contentType, expiresIn = 3600, upsert }: SignedUploadRequest,
  ): Promise<SignedUploadResult> {
    // The URL binds neither type nor length; the bucket's allowed_mime_types
    // and file_size_limit apply when the PUT arrives (KB-28).
    const bucketApi = this.client.storage.from(bucket);
    const { data, error } = upsert
      ? await bucketApi.createSignedUploadUrl(path, { upsert: true })
      : await bucketApi.createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message}`);
    }

    const publicUrl = this.getPublicUrl(bucket, path);

    return {
      uploadUrl: data.signedUrl,
      publicUrl,
      expiresIn,
      headers: { 'Content-Type': contentType },
    };
  }

  getPublicUrl(bucket: string, path: string): string {
    const {
      data: { publicUrl },
    } = this.client.storage.from(bucket).getPublicUrl(path);

    return publicUrl;
  }

  async delete(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);

    if (error) {
      throw new Error(`Storage delete failed: ${error.message}`);
    }
  }

  async exists(bucket: string, path: string): Promise<boolean> {
    // List files in the directory to check existence
    const dirPath = path.split('/').slice(0, -1).join('/');
    const fileName = path.split('/').pop();

    const { data, error } = await this.client.storage
      .from(bucket)
      .list(dirPath, {
        limit: 1,
        search: fileName,
      });

    if (error) {
      return false;
    }

    return data.some((file) => file.name === fileName);
  }

  async read(bucket: string, path: string): Promise<Buffer | null> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(path);

    if (error) {
      if (error.message.includes('not found')) {
        return null;
      }
      throw new Error(`Storage read failed: ${error.message}`);
    }

    // Convert Blob to Buffer
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Signed by Supabase Storage as the client's role: with a user's client,
   * the bucket's read policy decides whether a URL is issued at all.
   */
  async getSignedReadUrl(
    bucket: string,
    path: string,
    expiresIn: number,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data) {
      throw new Error(`Failed to create signed read URL: ${error?.message}`);
    }

    return data.signedUrl;
  }

  async stat(bucket: string, path: string): Promise<StoredObjectInfo | null> {
    const { data, error } = await this.client.storage.from(bucket).info(path);

    if (error) {
      const status = Number(
        (error as { status?: number; statusCode?: string | number }).status ??
          (error as { statusCode?: string | number }).statusCode,
      );

      if (status === 404 || /not found/i.test(error.message)) return null;

      throw new Error(`Storage stat failed: ${error.message}`);
    }

    return {
      bytes: Number(data.size ?? data.metadata?.size ?? 0),
      contentType:
        data.contentType ??
        (data.metadata?.mimetype as string | undefined) ??
        null,
    };
  }
}

/**
 * Create a Supabase storage adapter instance
 */
export function createSupabaseStorageAdapter(
  client: Client,
): SupabaseStorageAdapter {
  return new SupabaseStorageAdapter(client);
}
