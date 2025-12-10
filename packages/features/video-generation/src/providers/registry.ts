import type { VideoGenerationProvider } from './base';
import { HailuoProvider } from './hailuo';
import { KlingProvider } from './kling';
import { LumaProvider } from './luma';
import { RunwayProvider } from './runway';
import type {
  ProviderRegistryEntry,
  VideoProviderConfig,
  VideoProviderMetadata,
  VideoProviderName,
} from './types';

/**
 * Provider registry containing metadata and factories for all video providers
 */
const PROVIDER_REGISTRY = new Map<VideoProviderName, ProviderRegistryEntry>([
  [
    'kling',
    {
      metadata: {
        name: 'kling',
        displayName: 'Kling AI',
        description:
          'High-quality video generation with v1.5 model. Supports image-to-video and negative prompts.',
        supportedAspectRatios: ['16:9', '9:16', '1:1'],
        maxDuration: 10,
        minDuration: 5,
        supportsImageToVideo: true,
        costPerSecond: {
          standard: 10, // $0.10/second in cents
          professional: 30, // $0.30/second in cents
        },
      },
      factory: (config: VideoProviderConfig) =>
        new KlingProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          webhookSecret: config.webhookUrl,
        }),
    },
  ],
  [
    'runway',
    {
      metadata: {
        name: 'runway',
        displayName: 'Runway Gen-3',
        description:
          'Professional-grade video generation with Gen-3 Alpha and Turbo models. Longest duration support.',
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:5'],
        maxDuration: 18,
        minDuration: 5,
        supportsImageToVideo: true,
        costPerSecond: {
          standard: 0.5, // $0.005/second (turbo) in cents
          professional: 1, // $0.01/second (alpha) in cents
        },
      },
      factory: (config: VideoProviderConfig) =>
        new RunwayProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          webhookSecret: config.webhookUrl,
        }),
    },
  ],
  [
    'hailuo',
    {
      metadata: {
        name: 'hailuo',
        displayName: 'Hailuo (MiniMax)',
        description:
          'Ultra-fast budget-friendly video generation. ~20 second processing time.',
        supportedAspectRatios: ['16:9', '9:16', '1:1'],
        maxDuration: 6,
        minDuration: 5,
        supportsImageToVideo: true,
        costPerSecond: {
          standard: 6.7, // Flat $0.40 / 6s ≈ $0.067/second in cents
          professional: 6.7, // Same rate for all
        },
      },
      factory: (config: VideoProviderConfig) =>
        new HailuoProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          webhookSecret: config.webhookUrl,
        }),
    },
  ],
  [
    'luma',
    {
      metadata: {
        name: 'luma',
        displayName: 'Luma AI',
        description:
          'Luma Dream Machine for video generation. Currently in development.',
        supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        maxDuration: 5,
        minDuration: 5,
        supportsImageToVideo: true,
        costPerSecond: {
          standard: 5, // $0.05/second in cents (estimated)
          professional: 10, // $0.10/second in cents (estimated)
        },
      },
      factory: (config: VideoProviderConfig) =>
        new LumaProvider({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          webhookSecret: config.webhookUrl,
        }),
    },
  ],
]);

/**
 * Get a provider registry entry by name
 */
export function getProviderEntry(
  name: VideoProviderName,
): ProviderRegistryEntry | undefined {
  return PROVIDER_REGISTRY.get(name);
}

/**
 * Get metadata for a specific provider
 */
export function getProviderMetadata(
  providerName: VideoProviderName,
): VideoProviderMetadata | null {
  const entry = PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata ?? null;
}

/**
 * Get metadata for all registered providers
 */
export function getAllProviderMetadata(): VideoProviderMetadata[] {
  return Array.from(PROVIDER_REGISTRY.values()).map((entry) => entry.metadata);
}

/**
 * Get all registered provider names
 */
export function getRegisteredProviderNames(): VideoProviderName[] {
  return Array.from(PROVIDER_REGISTRY.keys());
}

/**
 * Check if a provider is registered
 */
export function isProviderRegistered(name: string): name is VideoProviderName {
  return PROVIDER_REGISTRY.has(name as VideoProviderName);
}

/**
 * Create a provider instance from the registry
 * This is a low-level function - prefer createAccountVideoProvider for production use
 */
export function createProviderFromRegistry(
  name: VideoProviderName,
  config: VideoProviderConfig,
): VideoGenerationProvider {
  const entry = PROVIDER_REGISTRY.get(name);
  if (!entry) {
    throw new Error(`Video provider not found: ${name}`);
  }
  return entry.factory(config);
}

/**
 * Register a new provider (for extensibility/testing)
 * Use with caution - prefer using built-in providers
 */
export function registerProvider(
  name: VideoProviderName,
  metadata: VideoProviderMetadata,
  factory: (config: VideoProviderConfig) => VideoGenerationProvider,
): void {
  PROVIDER_REGISTRY.set(name, { metadata, factory });
}
