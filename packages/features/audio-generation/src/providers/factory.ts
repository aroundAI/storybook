import type {
  VoiceProviderConfig,
  VoiceProviderFactoryOptions,
  VoiceProviderMetadata,
  VoiceProviderName,
} from '../lib/types';
import type { VoiceGenerationProvider } from './base';
import {
  hasVoiceProviderApiKey,
  loadVoiceProviderConfig,
} from './config-loader';
import { VoiceProviderNotFoundError } from './errors';
import {
  createVoiceProviderFromRegistry,
  getAllVoiceProviderMetadata,
  getRegisteredVoiceProviderNames,
  isVoiceProviderRegistered,
} from './registry';

// =============================================================================
// Types
// =============================================================================

interface CachedVoiceProvider {
  instance: VoiceGenerationProvider;
  configHash: string;
}

// =============================================================================
// Basic Factory (synchronous, config-based)
// Used by queue processor and internal workers
// =============================================================================

// Provider instances are cached per Lambda invocation.
// Each Lambda container has isolated memory, so no cross-request cache sharing.
const voiceProviderInstances = new Map<
  VoiceProviderName,
  CachedVoiceProvider
>();

function hashConfig(config: VoiceProviderConfig): string {
  return JSON.stringify({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    // Include userId for voice providers (e.g., PlayHT requires userId)
    userId: 'userId' in config ? config.userId : undefined,
  });
}

/**
 * Create a voice provider with explicit configuration
 * For internal use by queue processor and workers
 */
export function createVoiceProvider(
  provider: VoiceProviderName,
  config: VoiceProviderConfig,
): VoiceGenerationProvider {
  const configHash = hashConfig(config);

  // Check if already cached with same config
  const cached = voiceProviderInstances.get(provider);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create new instance and cache it
  const instance = createVoiceProviderFromRegistry(provider, config);
  voiceProviderInstances.set(provider, { instance, configHash });

  return instance;
}

/**
 * Get a cached voice provider instance
 */
export function getVoiceProvider(
  provider: VoiceProviderName,
): VoiceGenerationProvider | undefined {
  const cached = voiceProviderInstances.get(provider);
  return cached?.instance;
}

/**
 * Clear the basic provider cache
 */
export function clearProviderCache(): void {
  voiceProviderInstances.clear();
}

// =============================================================================
// Account-Based Factory (async, database-driven)
// Used by server actions and API routes
// =============================================================================

// Account-based provider cache: key = `${accountId}:${providerName}`
const accountVoiceProviderCache = new Map<string, CachedVoiceProvider>();

/**
 * Create a cache key for account-based provider caching
 */
function makeAccountCacheKey(
  accountId: string,
  providerName: VoiceProviderName,
): string {
  return `${accountId}:${providerName}`;
}

/**
 * Create a voice provider for an account
 *
 * Loads configuration from:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 *
 * Caches provider instances per account to avoid repeated database queries
 * and decryption operations.
 *
 * @param options - Factory options with accountId and optional provider
 * @returns Configured voice generation provider
 * @throws VoiceProviderNotFoundError if provider not in registry
 * @throws NoAPIKeyError if no API key available
 */
export async function createAccountVoiceProvider(
  options: VoiceProviderFactoryOptions,
): Promise<VoiceGenerationProvider> {
  const { accountId } = options;

  // Determine which provider to use
  const providerName =
    options.provider ?? (await getDefaultVoiceProvider(accountId));

  // Validate provider exists in registry
  if (!isVoiceProviderRegistered(providerName)) {
    throw new VoiceProviderNotFoundError(providerName);
  }

  // Load configuration (handles BYOK vs platform key)
  const config = await loadVoiceProviderConfig(accountId, providerName);

  // Compute config hash for cache validation
  const configHash = hashConfig(config);

  // Check cache - only use if config hasn't changed
  const cacheKey = makeAccountCacheKey(accountId, providerName);
  const cached = accountVoiceProviderCache.get(cacheKey);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create provider instance from registry
  const instance = createVoiceProviderFromRegistry(providerName, config);

  // Cache the instance with config hash
  accountVoiceProviderCache.set(cacheKey, { instance, configHash });

  return instance;
}

// =============================================================================
// Metadata & Availability
// =============================================================================

/**
 * Re-export metadata functions from registry
 */
export {
  getAllVoiceProviderMetadata,
  getRegisteredVoiceProviderNames,
  getVoiceProviderMetadata,
} from './registry';

/**
 * Check if a voice provider is available for an account
 * A provider is available if it has an API key (BYOK or platform)
 */
export async function isVoiceProviderAvailable(
  accountId: string,
  providerName: VoiceProviderName,
): Promise<boolean> {
  if (!isVoiceProviderRegistered(providerName)) {
    return false;
  }

  return hasVoiceProviderApiKey(accountId, providerName);
}

/**
 * Get list of available voice providers for an account
 * Returns providers that have API keys configured (BYOK or platform)
 */
export async function getAvailableVoiceProviders(
  accountId: string,
): Promise<VoiceProviderMetadata[]> {
  const allProviders = getAllVoiceProviderMetadata();
  const available: VoiceProviderMetadata[] = [];

  for (const provider of allProviders) {
    const isAvailable = await isVoiceProviderAvailable(
      accountId,
      provider.name,
    );
    if (isAvailable) {
      available.push(provider);
    }
  }

  return available;
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Clear account-based voice provider cache
 *
 * @param accountId - If provided, only clears cache for this account.
 *                    If not provided, clears all cached providers.
 */
export function clearAccountVoiceProviderCache(accountId?: string): void {
  if (accountId) {
    // Clear specific account's cached providers
    for (const key of accountVoiceProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        accountVoiceProviderCache.delete(key);
      }
    }
  } else {
    // Clear all
    accountVoiceProviderCache.clear();
  }
}

/**
 * Clear all account-based provider caches
 *
 * @param accountId - If provided, only clears cache for this account.
 *                    If not provided, clears all cached providers.
 */
export function clearAccountProviderCache(accountId?: string): void {
  clearAccountVoiceProviderCache(accountId);
}

// =============================================================================
// Default Provider Resolution
// =============================================================================

/**
 * Get the default voice provider for an account
 * Returns the first available provider
 *
 * Future enhancement: Could read from accounts.settings.defaultVoiceProvider
 */
async function getDefaultVoiceProvider(
  accountId: string,
): Promise<VoiceProviderName> {
  const providerNames = getRegisteredVoiceProviderNames();

  for (const name of providerNames) {
    const available = await hasVoiceProviderApiKey(accountId, name);
    if (available) {
      return name;
    }
  }

  // If no providers available, default to elevenlabs (will fail with NoAPIKeyError when loading config)
  return 'elevenlabs';
}
