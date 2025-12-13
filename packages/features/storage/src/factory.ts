/**
 * Storage Adapter Factory
 *
 * Creates the appropriate storage adapter based on configuration.
 * Supports switching between local and cloud storage via environment variables.
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { LocalStorageAdapter } from './adapters/local';
import { SupabaseStorageAdapter } from './adapters/supabase';
import type { StorageAdapter } from './types';

/**
 * Available storage provider types
 */
export type StorageProvider = 'local' | 'supabase';

/**
 * Get the configured storage provider
 */
export function getStorageProvider(): StorageProvider {
    const provider = process.env.STORAGE_PROVIDER?.toLowerCase();

    if (provider === 'local') {
        return 'local';
    }

    // Default to supabase for backward compatibility
    return 'supabase';
}

/**
 * Create a storage adapter based on the environment configuration
 *
 * @param supabaseClient - Supabase client (required for 'supabase' provider)
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
): StorageAdapter {
    const provider = getStorageProvider();

    if (provider === 'local') {
        return new LocalStorageAdapter();
    }

    if (!supabaseClient) {
        throw new Error(
            'Supabase client is required for supabase storage provider. ' +
            'Either pass a client or set STORAGE_PROVIDER=local.',
        );
    }

    return new SupabaseStorageAdapter(supabaseClient);
}

/**
 * Check if local storage is enabled
 */
export function isLocalStorageEnabled(): boolean {
    return getStorageProvider() === 'local';
}
