/**
 * Local Filesystem Storage Adapter
 *
 * Stores files on the local filesystem for development and local-first usage.
 * Files are served via a Next.js API route at /api/storage/[...path]
 */
import 'server-only';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

import type {
  SignedUploadResult,
  StorageAdapter,
  UploadOptions,
  UploadResult,
} from '../types';

/**
 * Expand tilde (~) in paths to the user's home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return join(home, filePath.slice(2));
  }
  if (filePath === '~') {
    return process.env.HOME || process.env.USERPROFILE || '';
  }
  return filePath;
}

/**
 * Default base path for local storage
 * Can be overridden via constructor or STORAGE_LOCAL_PATH env var
 */
const DEFAULT_BASE_PATH = expandTilde(
  process.env.STORAGE_LOCAL_PATH || join(process.cwd(), '.storage'),
);

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;
  private baseUrl: string;

  constructor(options?: { basePath?: string; baseUrl?: string }) {
    this.basePath = expandTilde(options?.basePath || DEFAULT_BASE_PATH);
    this.baseUrl =
      options?.baseUrl ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000';

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

  async getSignedUploadUrl(
    _bucket: string,
    _path: string,
    _contentType: string,
    _expiresIn?: number,
  ): Promise<SignedUploadResult> {
    // Local storage doesn't support presigned URLs
    // For development, use the regular upload endpoint
    throw new Error(
      'Local storage does not support presigned URLs. ' +
        'Use server-side upload or switch to R2/Supabase for production.',
    );
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
export function createLocalStorageAdapter(options?: {
  basePath?: string;
  baseUrl?: string;
}): LocalStorageAdapter {
  return new LocalStorageAdapter(options);
}
