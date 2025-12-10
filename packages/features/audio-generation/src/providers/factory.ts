import type {
  MusicProviderConfig,
  MusicProviderFactoryOptions,
  MusicProviderMetadata,
  MusicProviderName,
  VoiceProviderConfig,
  VoiceProviderFactoryOptions,
  VoiceProviderMetadata,
  VoiceProviderName,
} from '../lib/types';
import type { MusicGenerationProvider, VoiceGenerationProvider } from './base';
import {
  hasMusicProviderApiKey,
  hasVoiceProviderApiKey,
  loadMusicProviderConfig,
  loadVoiceProviderConfig,
} from './config-loader';
import {
  MusicProviderNotFoundError,
  VoiceProviderNotFoundError,
} from './errors';
import {
  createMusicProviderFromRegistry,
  createVoiceProviderFromRegistry,
  getAllMusicProviderMetadata,
  getAllVoiceProviderMetadata,
  getRegisteredMusicProviderNames,
  getRegisteredVoiceProviderNames,
  isMusicProviderRegistered,
  isVoiceProviderRegistered,
} from './registry';

// =============================================================================
// Types
// =============================================================================

interface CachedVoiceProvider {
  instance: VoiceGenerationProvider;
  configHash: string;
}

interface CachedMusicProvider {
  instance: MusicGenerationProvider;
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
const musicProviderInstances = new Map<
  MusicProviderName,
  CachedMusicProvider
>();

function hashConfig(config: VoiceProviderConfig | MusicProviderConfig): string {
  return JSON.stringify({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
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
 * Create a music provider with explicit configuration
 * For internal use by queue processor and workers
 */
export function createMusicProvider(
  provider: MusicProviderName,
  config: MusicProviderConfig,
): MusicGenerationProvider {
  const configHash = hashConfig(config);

  // Check if already cached with same config
  const cached = musicProviderInstances.get(provider);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create new instance and cache it
  const instance = createMusicProviderFromRegistry(provider, config);
  musicProviderInstances.set(provider, { instance, configHash });

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
 * Get a cached music provider instance
 */
export function getMusicProvider(
  provider: MusicProviderName,
): MusicGenerationProvider | undefined {
  const cached = musicProviderInstances.get(provider);
  return cached?.instance;
}

/**
 * Clear the basic provider cache
 */
export function clearProviderCache(): void {
  voiceProviderInstances.clear();
  musicProviderInstances.clear();
}

// =============================================================================
// Account-Based Factory (async, database-driven)
// Used by server actions and API routes
// =============================================================================

// Account-based provider cache: key = `${accountId}:${providerName}`
const accountVoiceProviderCache = new Map<string, CachedVoiceProvider>();
const accountMusicProviderCache = new Map<string, CachedMusicProvider>();

/**
 * Create a cache key for account-based provider caching
 */
function makeAccountCacheKey(
  accountId: string,
  providerName: VoiceProviderName | MusicProviderName,
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

/**
 * Create a music provider for an account
 *
 * Loads configuration from:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 *
 * Caches provider instances per account to avoid repeated database queries
 * and decryption operations.
 *
 * @param options - Factory options with accountId and optional provider
 * @returns Configured music generation provider
 * @throws MusicProviderNotFoundError if provider not in registry
 * @throws NoAPIKeyError if no API key available
 */
export async function createAccountMusicProvider(
  options: MusicProviderFactoryOptions,
): Promise<MusicGenerationProvider> {
  const { accountId } = options;

  // Determine which provider to use
  const providerName =
    options.provider ?? (await getDefaultMusicProvider(accountId));

  // Validate provider exists in registry
  if (!isMusicProviderRegistered(providerName)) {
    throw new MusicProviderNotFoundError(providerName);
  }

  // Load configuration (handles BYOK vs platform key)
  const config = await loadMusicProviderConfig(accountId, providerName);

  // Compute config hash for cache validation
  const configHash = hashConfig(config);

  // Check cache - only use if config hasn't changed
  const cacheKey = makeAccountCacheKey(accountId, providerName);
  const cached = accountMusicProviderCache.get(cacheKey);
  if (cached && cached.configHash === configHash) {
    return cached.instance;
  }

  // Create provider instance from registry
  const instance = createMusicProviderFromRegistry(providerName, config);

  // Cache the instance with config hash
  accountMusicProviderCache.set(cacheKey, { instance, configHash });

  return instance;
}

// =============================================================================
// Metadata & Availability
// =============================================================================

/**
 * Re-export metadata functions from registry
 */
export {
  getAllMusicProviderMetadata,
  getAllVoiceProviderMetadata,
  getRegisteredMusicProviderNames,
  getRegisteredVoiceProviderNames,
} from './registry';
export { getMusicProviderMetadata, getVoiceProviderMetadata } from './registry';

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
 * Check if a music provider is available for an account
 * A provider is available if it has an API key (BYOK or platform)
 */
export async function isMusicProviderAvailable(
  accountId: string,
  providerName: MusicProviderName,
): Promise<boolean> {
  if (!isMusicProviderRegistered(providerName)) {
    return false;
  }

  return hasMusicProviderApiKey(accountId, providerName);
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

/**
 * Get list of available music providers for an account
 * Returns providers that have API keys configured (BYOK or platform)
 */
export async function getAvailableMusicProviders(
  accountId: string,
): Promise<MusicProviderMetadata[]> {
  const allProviders = getAllMusicProviderMetadata();
  const available: MusicProviderMetadata[] = [];

  for (const provider of allProviders) {
    const isAvailable = await isMusicProviderAvailable(
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
 * Clear account-based music provider cache
 *
 * @param accountId - If provided, only clears cache for this account.
 *                    If not provided, clears all cached providers.
 */
export function clearAccountMusicProviderCache(accountId?: string): void {
  if (accountId) {
    // Clear specific account's cached providers
    for (const key of accountMusicProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        accountMusicProviderCache.delete(key);
      }
    }
  } else {
    // Clear all
    accountMusicProviderCache.clear();
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
  clearAccountMusicProviderCache(accountId);
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

/**
 * Get the default music provider for an account
 * Returns the first available provider
 *
 * Future enhancement: Could read from accounts.settings.defaultMusicProvider
 */
async function getDefaultMusicProvider(
  accountId: string,
): Promise<MusicProviderName> {
  const providerNames = getRegisteredMusicProviderNames();

  for (const name of providerNames) {
    const available = await hasMusicProviderApiKey(accountId, name);
    if (available) {
      return name;
    }
  }

  // If no providers available, default to suno (will fail with NoAPIKeyError when loading config)
  return 'suno';
}
