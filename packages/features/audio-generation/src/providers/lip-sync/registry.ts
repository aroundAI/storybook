import { SYNCLABS, WAV2LIP } from '../../lib/constants';
import { SyncLabsProvider } from './synclabs';
import type {
  LipSyncProvider,
  LipSyncProviderConfig,
  LipSyncProviderMetadata,
  LipSyncProviderName,
} from './types';
import { Wav2LipProvider } from './wav2lip';

/**
 * Lip sync provider registry entry containing metadata and factory function
 */
export interface LipSyncProviderRegistryEntry {
  metadata: LipSyncProviderMetadata;
  factory: (config: LipSyncProviderConfig) => LipSyncProvider;
}

/**
 * Lip sync provider registry containing metadata and factories for all lip sync providers
 */
const LIP_SYNC_PROVIDER_REGISTRY = new Map<
  LipSyncProviderName,
  LipSyncProviderRegistryEntry
>();

// Register SyncLabs provider
LIP_SYNC_PROVIDER_REGISTRY.set('synclabs', {
  metadata: {
    name: 'synclabs',
    displayName: 'SyncLabs',
    description: 'Production-ready lip sync API with high-quality results',
    supportedQualities: ['fast', 'standard', 'high'],
    costPerJob: SYNCLABS.COST_PER_JOB,
    averageProcessingTime: SYNCLABS.PROCESSING_TIME.STANDARD,
  },
  factory: (config: LipSyncProviderConfig) => new SyncLabsProvider(config),
});

// Register Wav2Lip provider
LIP_SYNC_PROVIDER_REGISTRY.set('wav2lip', {
  metadata: {
    name: 'wav2lip',
    displayName: 'Wav2Lip',
    description: 'Self-hosted lip sync for cost-effective processing',
    supportedQualities: ['fast', 'standard', 'high'],
    costPerJob: WAV2LIP.COST_PER_JOB,
    averageProcessingTime: WAV2LIP.PROCESSING_TIME.STANDARD,
  },
  factory: (config: LipSyncProviderConfig) => new Wav2LipProvider(config),
});

// =============================================================================
// Lip Sync Provider Registry Functions
// =============================================================================

/**
 * Get a lip sync provider registry entry by name
 */
export function getLipSyncProviderEntry(
  name: LipSyncProviderName,
): LipSyncProviderRegistryEntry | undefined {
  return LIP_SYNC_PROVIDER_REGISTRY.get(name);
}

/**
 * Get metadata for a specific lip sync provider
 */
export function getLipSyncProviderMetadata(
  providerName: LipSyncProviderName,
): LipSyncProviderMetadata | null {
  const entry = LIP_SYNC_PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata ?? null;
}

/**
 * Get metadata for all registered lip sync providers
 */
export function getAllLipSyncProviderMetadata(): LipSyncProviderMetadata[] {
  return Array.from(LIP_SYNC_PROVIDER_REGISTRY.values()).map(
    (entry) => entry.metadata,
  );
}

/**
 * Get all registered lip sync provider names
 */
export function getRegisteredLipSyncProviderNames(): LipSyncProviderName[] {
  return Array.from(LIP_SYNC_PROVIDER_REGISTRY.keys());
}

/**
 * Check if a lip sync provider is registered
 */
export function isLipSyncProviderRegistered(
  name: string,
): name is LipSyncProviderName {
  return LIP_SYNC_PROVIDER_REGISTRY.has(name as LipSyncProviderName);
}

/**
 * Create a lip sync provider instance from the registry
 * This is a low-level function - prefer createAccountLipSyncProvider for production use
 */
export function createLipSyncProviderFromRegistry(
  name: LipSyncProviderName,
  config: LipSyncProviderConfig,
): LipSyncProvider {
  const entry = LIP_SYNC_PROVIDER_REGISTRY.get(name);
  if (!entry) {
    throw new Error(`Lip sync provider not found: ${name}`);
  }
  return entry.factory(config);
}

/**
 * Register a new lip sync provider (for extensibility/testing)
 * Use with caution - prefer using built-in providers
 */
export function registerLipSyncProvider(
  name: LipSyncProviderName,
  metadata: LipSyncProviderMetadata,
  factory: (config: LipSyncProviderConfig) => LipSyncProvider,
): void {
  LIP_SYNC_PROVIDER_REGISTRY.set(name, { metadata, factory });
}
