/**
 * Storage Adapter Package
 *
 * Provides a unified interface for file storage operations with
 * pluggable backends (local filesystem, Supabase Storage, S3, etc.)
 */

export type { StorageAdapter, UploadOptions, UploadResult } from './types';
export { getStorageAdapter, isLocalStorageEnabled } from './factory';
export type { StorageProvider } from './factory';
export { LocalStorageAdapter } from './adapters/local';
export { SupabaseStorageAdapter } from './adapters/supabase';
