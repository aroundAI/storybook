import { createHash } from 'crypto';

import {
  createLipSyncProviderFromRegistry,
  getRegisteredLipSyncProviderNames,
  isLipSyncProviderRegistered,
} from './registry';
import type {
  LipSyncProvider,
  LipSyncProviderConfig,
  LipSyncProviderFactoryOptions,
  LipSyncProviderName,
} from './types';

/**
 * Cache for lip sync provider instances
 * Uses config hash to invalidate when config changes
 */
interface CachedProvider {
  provider: LipSyncProvider;
  configHash: string;
}

/**
 * Provider instances cache (per Lambda invocation)
 */
const lipSyncProviderInstances = new Map<string, CachedProvider>();

/**
 * Account-level provider cache
 */
const accountLipSyncProviderCache = new Map<string, CachedProvider>();

/**
 * Generate a hash of the provider config for cache invalidation
 */
function hashConfig(config: LipSyncProviderConfig): string {
  const configString = JSON.stringify({
    apiKey: config.apiKey?.slice(0, 8), // Only use first 8 chars for hashing
    baseUrl: config.baseUrl,
    timeout: config.timeout,
    maxRetries: config.maxRetries,
  });
  return createHash('md5').update(configString).digest('hex');
}

/**
 * Create a lip sync provider with caching
 * For internal use in workers or when config is explicitly provided
 */
export function createLipSyncProvider(
  provider: LipSyncProviderName,
  config: LipSyncProviderConfig,
): LipSyncProvider {
  const cacheKey = provider;
  const configHash = hashConfig(config);

  // Check cache
  const cached = lipSyncProviderInstances.get(cacheKey);
  if (cached && cached.configHash === configHash) {
    return cached.provider;
  }

  // Create new instance
  const instance = createLipSyncProviderFromRegistry(provider, config);

  // Cache it
  lipSyncProviderInstances.set(cacheKey, {
    provider: instance,
    configHash,
  });

  return instance;
}

/**
 * Create a lip sync provider for an account
 * Loads configuration from BYOK or platform environment
 */
export async function createAccountLipSyncProvider(
  options: LipSyncProviderFactoryOptions,
): Promise<LipSyncProvider> {
  const { accountId, provider = 'synclabs' } = options;

  if (!isLipSyncProviderRegistered(provider)) {
    throw new Error(`Unknown lip sync provider: ${provider}`);
  }

  const cacheKey = `${accountId}:${provider}`;

  // Load config from environment (BYOK support would query database here)
  const config = await loadLipSyncProviderConfig(accountId, provider);
  const configHash = hashConfig(config);

  // Check cache
  const cached = accountLipSyncProviderCache.get(cacheKey);
  if (cached && cached.configHash === configHash) {
    return cached.provider;
  }

  // Create new instance
  const instance = createLipSyncProviderFromRegistry(provider, config);

  // Cache it
  accountLipSyncProviderCache.set(cacheKey, {
    provider: instance,
    configHash,
  });

  return instance;
}

/**
 * Load lip sync provider config from environment or database
 */
async function loadLipSyncProviderConfig(
  _accountId: string,
  provider: LipSyncProviderName,
): Promise<LipSyncProviderConfig> {
  // In production, this would query the external_api_keys table
  // For now, load from environment variables

  switch (provider) {
    case 'synclabs': {
      const apiKey = process.env.SYNCLABS_API_KEY;
      if (!apiKey) {
        throw new Error('SYNCLABS_API_KEY environment variable is not set');
      }
      return {
        apiKey,
        baseUrl: process.env.SYNCLABS_BASE_URL,
        timeout: 60000,
        maxRetries: 3,
      };
    }
    case 'wav2lip': {
      const apiKey = process.env.WAV2LIP_API_KEY;
      if (!apiKey) {
        throw new Error('WAV2LIP_API_KEY environment variable is not set');
      }
      return {
        apiKey,
        baseUrl: process.env.WAV2LIP_API_URL,
        timeout: 60000,
        maxRetries: 3,
      };
    }
    default:
      throw new Error(`Unknown lip sync provider: ${provider}`);
  }
}

/**
 * Check if a lip sync provider is available for an account
 */
export async function isLipSyncProviderAvailable(
  accountId: string,
  provider: LipSyncProviderName,
): Promise<boolean> {
  try {
    await loadLipSyncProviderConfig(accountId, provider);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available lip sync providers for an account
 */
export async function getAvailableLipSyncProviders(
  accountId: string,
): Promise<LipSyncProviderName[]> {
  const allProviders = getRegisteredLipSyncProviderNames();
  const available: LipSyncProviderName[] = [];

  for (const provider of allProviders) {
    if (await isLipSyncProviderAvailable(accountId, provider)) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Clear provider cache for an account (or all accounts)
 */
export function clearLipSyncProviderCache(accountId?: string): void {
  if (accountId) {
    // Clear specific account's cache
    for (const key of accountLipSyncProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        accountLipSyncProviderCache.delete(key);
      }
    }
  } else {
    // Clear all caches
    lipSyncProviderInstances.clear();
    accountLipSyncProviderCache.clear();
  }
}
