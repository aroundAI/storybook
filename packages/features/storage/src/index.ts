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
export type {
  SignedUploadRequest,
  SignedUploadResult,
  StorageAdapter,
  UploadOptions,
  UploadResult,
} from './types';
export type { StorageProvider } from './factory';
export type { AssetType } from './routing';

// Factory functions
export {
  getStorageAdapter,
  getStorageAdapterForContentType,
  getStorageAdapterForPath,
  getStorageProvider,
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

// Public URL → object key, and deletes confined to an owner's folder (KB-54)
export {
  deleteOwnedObject,
  ownedAudioAssetLocation,
  ownedStorageKey,
  storageKeyFromPublicUrl,
} from './storage-key';
export type { OwnedDeleteResult } from './storage-key';

// The project check every server-side write goes through (KB-57)
export {
  StorageWriteRefused,
  canWriteProjectKey,
  writeProjectObject,
} from './project-write';
export type { ProjectKeyClient } from './project-write';

// Adapters (for direct instantiation if needed)
export { LocalStorageAdapter } from './adapters/local';
export { SupabaseStorageAdapter } from './adapters/supabase';
export { R2StorageAdapter } from './adapters/r2';
export { B2StorageAdapter } from './adapters/b2';
