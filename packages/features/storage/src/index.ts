/**
 * Storage Adapter Package (Server-Only)
 *
 * Provides a unified interface for file storage operations with
 * pluggable backends (local filesystem, Supabase Storage, R2, B2)
 * and smart routing based on content type.
 *
 * NOTE: For client-side uploads, import from '@kit/storage/client' instead.
 */

// Types
export type { SignedUploadResult, StorageAdapter, UploadOptions, UploadResult } from './types';
export type { StorageProvider } from './factory';
export type { AssetType } from './routing';

// Factory functions
export {
    getStorageAdapter,
    getStorageAdapterForContentType,
    getStorageAdapterForPath,
    getStorageProvider,
    isB2StorageEnabled,
    isLocalStorageEnabled,
    isR2StorageEnabled,
} from './factory';

// Routing utilities
export {
    getAssetTypeFromContentType,
    getAssetTypeFromPath,
    getProviderForAssetType,
    getProviderForContentType,
    getProviderForPath,
    isSmartRoutingEnabled,
} from './routing';

// Adapters (for direct instantiation if needed)
export { LocalStorageAdapter } from './adapters/local';
export { SupabaseStorageAdapter } from './adapters/supabase';
export { R2StorageAdapter } from './adapters/r2';
export { B2StorageAdapter } from './adapters/b2';
