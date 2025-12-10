import type { ProviderConfig, VideoProvider } from '../lib/types';
import type { VideoGenerationProvider } from './base';
import { hasProviderApiKey, loadProviderConfig } from './config-loader';
import { ProviderNotFoundError } from './errors';
import { HailuoProvider } from './hailuo';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import {
  createProviderFromRegistry,
  getRegisteredProviderNames,
  getAllProviderMetadata as getRegistryMetadata,
  getProviderMetadata as getRegistryProviderMetadata,
  isProviderRegistered,
} from './registry';
import { RunwayProvider } from './runway';
import type {
  ProviderFactoryOptions,
  VideoProviderMetadata,
  VideoProviderName,
} from './types';

// =============================================================================
// Basic Factory (synchronous, config-based)
// Used by queue processor and internal workers
// =============================================================================

interface CachedProvider {
  instance: VideoGenerationProvider;
  configHash: string;
}

// Provider instances are cached per Lambda invocation.
// Each Lambda container has isolated memory, so no cross-request cache sharing.
const providerInstances = new Map<VideoProvider, CachedProvider>();

function hashConfig(config: ProviderConfig): string {
  return JSON.stringify({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

function createProviderInstance(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  switch (provider) {
    case 'kling':
      return new KlingProvider(config);
    case 'runway':
      return new RunwayProvider(config);
    case 'luma':
      return new LumaProvider(config);
    case 'hailuo':
      return new HailuoProvider(config);
    default:
      throw new Error(`Unknown video provider: ${provider}`);
  }
}

/**
 * Create a video provider with explicit configuration
 * For internal use by queue processor and workers
 */
export function createVideoProvider(
  provider: VideoProvider,
  config: ProviderConfig,
): VideoGenerationProvider {
  const configHash = hashConfig(config);

  // Check if already cached with same config
  const cached = providerInstances.get(provider);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create new instance and cache it
  const instance = createProviderInstance(provider, config);
  providerInstances.set(provider, { instance, configHash });

  return instance;
}

/**
 * Get a cached provider instance
 */
export function getVideoProvider(
  provider: VideoProvider,
): VideoGenerationProvider | undefined {
  const cached = providerInstances.get(provider);
  return cached?.instance;
}

/**
 * Clear the basic provider cache
 */
export function clearProviderCache(): void {
  providerInstances.clear();
}

// =============================================================================
// Account-Based Factory (async, database-driven)
// Used by server actions and API routes
// =============================================================================

interface AccountCachedProvider {
  instance: VideoGenerationProvider;
  configHash: string;
}

// Account-based provider cache: key = `${accountId}:${providerName}`
const accountProviderCache = new Map<string, AccountCachedProvider>();

/**
 * Create a cache key for account-based provider caching
 */
function makeAccountCacheKey(
  accountId: string,
  providerName: VideoProviderName,
): string {
  return `${accountId}:${providerName}`;
}

/**
 * Create a video provider for an account
 *
 * Loads configuration from:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 *
 * Caches provider instances per account to avoid repeated database queries
 * and decryption operations.
 *
 * @param options - Factory options with accountId and optional provider
 * @returns Configured video generation provider
 * @throws ProviderNotFoundError if provider not in registry
 * @throws NoAPIKeyError if no API key available
 */
export async function createAccountVideoProvider(
  options: ProviderFactoryOptions,
): Promise<VideoGenerationProvider> {
  const { accountId, webhookBaseUrl } = options;

  // Determine which provider to use
  const providerName =
    options.provider ?? (await getDefaultProvider(accountId));

  // Validate provider exists in registry
  if (!isProviderRegistered(providerName)) {
    throw new ProviderNotFoundError(providerName);
  }

  // Load configuration (handles BYOK vs platform key)
  const config = await loadProviderConfig(
    accountId,
    providerName,
    webhookBaseUrl,
  );

  // Compute config hash for cache validation
  const configHash = hashConfig(config);

  // Check cache - only use if config hasn't changed
  const cacheKey = makeAccountCacheKey(accountId, providerName);
  const cached = accountProviderCache.get(cacheKey);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create provider instance from registry
  const instance = createProviderFromRegistry(providerName, config);

  // Cache the instance with config hash
  accountProviderCache.set(cacheKey, { instance, configHash });

  return instance;
}

/**
 * Get metadata for a specific provider
 */
export function getProviderMetadata(
  providerName: VideoProviderName,
): VideoProviderMetadata | null {
  return getRegistryProviderMetadata(providerName);
}

/**
 * Get metadata for all registered providers
 */
export function getAllProviderMetadata(): VideoProviderMetadata[] {
  return getRegistryMetadata();
}

/**
 * Check if a provider is available for an account
 * A provider is available if it has an API key (BYOK or platform)
 */
export async function isProviderAvailable(
  accountId: string,
  providerName: VideoProviderName,
): Promise<boolean> {
  if (!isProviderRegistered(providerName)) {
    return false;
  }

  return hasProviderApiKey(accountId, providerName);
}

/**
 * Get list of available providers for an account
 * Returns providers that have API keys configured (BYOK or platform)
 */
export async function getAvailableProviders(
  accountId: string,
): Promise<VideoProviderMetadata[]> {
  const allProviders = getAllProviderMetadata();
  const available: VideoProviderMetadata[] = [];

  for (const provider of allProviders) {
    const isAvailable = await isProviderAvailable(accountId, provider.name);
    if (isAvailable) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Clear account-based provider cache
 *
 * @param accountId - If provided, only clears cache for this account.
 *                    If not provided, clears all cached providers.
 */
export function clearAccountProviderCache(accountId?: string): void {
  if (accountId) {
    // Clear specific account's cached providers
    for (const key of accountProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        accountProviderCache.delete(key);
      }
    }
  } else {
    // Clear all
    accountProviderCache.clear();
  }
}

/**
 * Get the default provider for an account
 * Returns the first available provider
 *
 * Future enhancement: Could read from accounts.settings.defaultVideoProvider
 */
async function getDefaultProvider(
  accountId: string,
): Promise<VideoProviderName> {
  const providerNames = getRegisteredProviderNames();

  for (const name of providerNames) {
    const available = await hasProviderApiKey(accountId, name);
    if (available) {
      return name;
    }
  }

  // If no providers available, default to kling (will fail with NoAPIKeyError when loading config)
  return 'kling';
}
