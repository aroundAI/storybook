/**
 * Storage Adapter Factory
 *
 * Creates the appropriate storage adapter based on configuration.
 * Supports multiple providers: local, supabase, r2, b2
 * Supports smart routing based on content type.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { B2StorageAdapter } from './adapters/b2';
import { LocalStorageAdapter } from './adapters/local';
import { R2StorageAdapter } from './adapters/r2';
import { SupabaseStorageAdapter } from './adapters/supabase';
import {
  getProviderForContentType,
  getProviderForPath,
  isSmartRoutingEnabled,
} from './routing';
import type { StorageAdapter } from './types';

/**
 * Available storage provider types
 */
export type StorageProvider = 'local' | 'supabase' | 'r2' | 'b2';

/**
 * Get the configured storage provider from environment
 */
export function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER?.toLowerCase();

  switch (provider) {
    case 'local':
      return 'local';
    case 'r2':
      return 'r2';
    case 'b2':
      return 'b2';
    case 'supabase':
    default:
      // Default to supabase for backward compatibility
      return 'supabase';
  }
}

/**
 * Create a storage adapter for a specific provider
 */
function createAdapterForProvider(
  provider: StorageProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: SupabaseClient<any, any, any>,
): StorageAdapter {
  switch (provider) {
    case 'local':
      return new LocalStorageAdapter();

    case 'r2':
      return new R2StorageAdapter();

    case 'b2':
      return new B2StorageAdapter();

    case 'supabase':
    default:
      if (!supabaseClient) {
        throw new Error(
          'Supabase client is required for supabase storage provider. ' +
            'Either pass a client or set STORAGE_PROVIDER to local, r2, or b2.',
        );
      }
      return new SupabaseStorageAdapter(supabaseClient);
  }
}

/**
 * Create a storage adapter based on the environment configuration
 *
 * @param supabaseClient - Supabase client (required for 'supabase' provider)
 * @param options - Optional configuration overrides
 * @returns Configured storage adapter
 *
 * @example
 * ```typescript
 * // In your server action or API route
 * const client = getSupabaseServerClient();
 * const storage = getStorageAdapter(client);
 *
 * await storage.upload('project-assets', 'images/hero.png', buffer, {
 *   contentType: 'image/png',
 * });
 * ```
 */
export function getStorageAdapter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: SupabaseClient<any, any, any>,
  options?: { provider?: StorageProvider },
): StorageAdapter {
  const provider = options?.provider ?? getStorageProvider();
  return createAdapterForProvider(provider, supabaseClient);
}

/**
 * Get storage adapter with smart routing based on content type
 *
 * Routes to the optimal provider:
 * - video/audio/thumbnails → R2 (zero egress)
 * - images/avatars → Supabase (fast CDN)
 *
 * @param contentType - MIME type of the content
 * @param supabaseClient - Supabase client (required if routing to Supabase)
 * @returns Storage adapter for the appropriate provider
 *
 * @example
 * ```typescript
 * const storage = getStorageAdapterForContentType('video/mp4', client);
 * // Returns R2 adapter for videos
 *
 * const imageStorage = getStorageAdapterForContentType('image/png', client);
 * // Returns Supabase adapter for images
 * ```
 */
export function getStorageAdapterForContentType(
  contentType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: SupabaseClient<any, any, any>,
): StorageAdapter {
  // Only use smart routing if enabled
  if (!isSmartRoutingEnabled()) {
    return getStorageAdapter(supabaseClient);
  }

  const provider = getProviderForContentType(contentType);
  return createAdapterForProvider(provider, supabaseClient);
}

/**
 * Get storage adapter with smart routing based on file path
 *
 * Analyzes the path to determine asset type and route appropriately:
 * - /dialogue/, /audio/, .mp3 → R2
 * - /final-video, /shorts/, .mp4 → R2
 * - /thumbnail → R2
 * - /avatar, .png, .jpg → Supabase
 *
 * @param path - Storage path for the file
 * @param supabaseClient - Supabase client (required if routing to Supabase)
 * @returns Storage adapter for the appropriate provider
 */
export function getStorageAdapterForPath(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: SupabaseClient<any, any, any>,
): StorageAdapter {
  // Only use smart routing if enabled
  if (!isSmartRoutingEnabled()) {
    return getStorageAdapter(supabaseClient);
  }

  const provider = getProviderForPath(path);
  return createAdapterForProvider(provider, supabaseClient);
}

/**
 * Check if local storage is enabled
 */
export function isLocalStorageEnabled(): boolean {
  return getStorageProvider() === 'local';
}

/**
 * Check if R2 storage is enabled
 */
export function isR2StorageEnabled(): boolean {
  return getStorageProvider() === 'r2';
}

/**
 * Check if B2 storage is enabled
 */
export function isB2StorageEnabled(): boolean {
  return getStorageProvider() === 'b2';
}
