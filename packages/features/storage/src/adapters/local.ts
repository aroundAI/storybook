/**
 * Local Filesystem Storage Adapter
 *
 * Stores files on the local filesystem for development and local-first usage.
 * Files are served via a Next.js API route at /api/storage/[...path]
 */

import 'server-only';

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { StorageAdapter, UploadOptions, UploadResult } from '../types';

/**
 * Default base path for local storage
 * Can be overridden via constructor or STORAGE_LOCAL_PATH env var
 */
const DEFAULT_BASE_PATH =
    process.env.STORAGE_LOCAL_PATH || join(process.cwd(), '.storage');

export class LocalStorageAdapter implements StorageAdapter {
    private basePath: string;
    private baseUrl: string;

    constructor(options?: { basePath?: string; baseUrl?: string }) {
        this.basePath = options?.basePath || DEFAULT_BASE_PATH;
        this.baseUrl =
            options?.baseUrl || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

        // Ensure base directory exists
        if (!existsSync(this.basePath)) {
            mkdirSync(this.basePath, { recursive: true });
        }
    }

    async upload(
        bucket: string,
        path: string,
        data: Buffer,
        _options: UploadOptions,
    ): Promise<UploadResult> {
        const fullPath = this.getFilePath(bucket, path);
        const dir = dirname(fullPath);

        // Ensure directory exists
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // Write file synchronously (simple and reliable for local usage)
        writeFileSync(fullPath, data);

        const url = this.getPublicUrl(bucket, path);

        return { path, url };
    }

    getPublicUrl(bucket: string, path: string): string {
        // Return URL pointing to the storage API route
        return `${this.baseUrl}/api/storage/${bucket}/${path}`;
    }

    async delete(bucket: string, path: string): Promise<void> {
        const fullPath = this.getFilePath(bucket, path);

        if (existsSync(fullPath)) {
            unlinkSync(fullPath);
        }
    }

    async exists(bucket: string, path: string): Promise<boolean> {
        const fullPath = this.getFilePath(bucket, path);
        return existsSync(fullPath);
    }

    async read(bucket: string, path: string): Promise<Buffer | null> {
        const fullPath = this.getFilePath(bucket, path);

        if (!existsSync(fullPath)) {
            return null;
        }

        return readFileSync(fullPath);
    }

    /**
     * Get the full filesystem path for a file
     */
    private getFilePath(bucket: string, path: string): string {
        return join(this.basePath, bucket, path);
    }

    /**
     * Get the base storage path (for debugging/admin)
     */
    getBasePath(): string {
        return this.basePath;
    }
}

/**
 * Create a local storage adapter instance
 */
export function createLocalStorageAdapter(
    options?: { basePath?: string; baseUrl?: string },
): LocalStorageAdapter {
    return new LocalStorageAdapter(options);
}
