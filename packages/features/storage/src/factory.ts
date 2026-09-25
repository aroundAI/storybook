/**
 * Storage Adapter Factory
 *
 * Creates the appropriate storage adapter based on configuration.
 * Two providers: R2 (production and staging) and Supabase (local dev and CI).
 * Supports smart routing based on content type.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { R2StorageAdapter } from './adapters/r2';
import { SupabaseStorageAdapter } from './adapters/supabase';
import {
  getProviderForContentType,
  getProviderForPath,
  isSmartRoutingEnabled,
} from './routing';
import type { StorageAdapter } from './types';

/**
 * The providers `STORAGE_PROVIDER` may name. `scripts/deploy.sh` refuses any
 * other value before a deploy (KB-70); keep its list the same.
 */
export const STORAGE_PROVIDERS = ['supabase', 'r2'] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

function isStorageProvider(value: string): value is StorageProvider {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The configured storage provider. Unset means Supabase, as in local dev and
 * CI. Any other value throws: `s3` used to fall back to Supabase silently,
 * though no S3 adapter exists (KB-70).
 */
export function getStorageProvider(): StorageProvider {
  const raw = process.env.STORAGE_PROVIDER;
  if (!raw) return 'supabase';

  const provider = raw.toLowerCase();
  if (isStorageProvider(provider)) return provider;

  throw new Error(
    `Unknown STORAGE_PROVIDER "${raw}": expected one of ${STORAGE_PROVIDERS.join(', ')} (KB-70)`,
  );
}

/**
 * Create a storage adapter for a specific provider
 */
function createAdapterForProvider(
  provider: StorageProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient?: SupabaseClient<any, any, any>,
): StorageAdapter {
  if (provider === 'r2') return new R2StorageAdapter();

  if (!supabaseClient) {
    throw new Error(
      'Supabase client is required for supabase storage provider. ' +
        'Either pass a client or set STORAGE_PROVIDER to r2.',
    );
  }
  return new SupabaseStorageAdapter(supabaseClient);
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
 * Check if R2 storage is enabled
 */
export function isR2StorageEnabled(): boolean {
  return getStorageProvider() === 'r2';
}
