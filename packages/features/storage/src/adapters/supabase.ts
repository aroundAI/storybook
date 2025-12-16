/**
 * Supabase Storage Adapter
 *
 * Wraps Supabase Storage for cloud-based file storage.
 * Used in production for multi-tenant SaaS deployments.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { StorageAdapter, UploadOptions, UploadResult } from '../types';

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
        const { error } = await this.client.storage.from(bucket).upload(path, data, {
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

        const { data, error } = await this.client.storage.from(bucket).list(dirPath, {
            limit: 1,
            search: fileName,
        });

        if (error) {
            return false;
        }

        return data.some((file) => file.name === fileName);
    }

    async read(bucket: string, path: string): Promise<Buffer | null> {
        const { data, error } = await this.client.storage.from(bucket).download(path);

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
}

/**
 * Create a Supabase storage adapter instance
 */
export function createSupabaseStorageAdapter(client: Client): SupabaseStorageAdapter {
    return new SupabaseStorageAdapter(client);
}
