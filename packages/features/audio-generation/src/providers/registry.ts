import { ELEVENLABS, PLAYHT } from '../lib/constants';
import type {
  VoiceProviderConfig,
  VoiceProviderMetadata,
  VoiceProviderName,
} from '../lib/types';
import type { VoiceGenerationProvider } from './base';
import { ElevenLabsProvider } from './elevenlabs';
import { PlayHTProvider } from './playht';

/**
 * Voice provider registry entry containing metadata and factory function
 */
export interface VoiceProviderRegistryEntry {
  metadata: VoiceProviderMetadata;
  factory: (config: VoiceProviderConfig) => VoiceGenerationProvider;
}

/**
 * Voice provider registry containing metadata and factories for all voice providers
 */
const VOICE_PROVIDER_REGISTRY = new Map<
  VoiceProviderName,
  VoiceProviderRegistryEntry
>();

// Register ElevenLabs provider
VOICE_PROVIDER_REGISTRY.set('elevenlabs', {
  metadata: {
    name: 'elevenlabs',
    displayName: 'ElevenLabs',
    description:
      'Premium AI voice synthesis with natural-sounding voices and voice cloning',
    supportedLanguages: [...ELEVENLABS.SUPPORTED_LANGUAGES],
    voiceCount: 120,
    supportsCloning: true,
    supportsStreaming: true,
    costPer1000Chars: ELEVENLABS.COST_PER_1000_CHARS,
    features: {
      stability: true,
      similarity: true,
      style: true,
      speed: true,
    },
  },
  factory: (config: VoiceProviderConfig) => new ElevenLabsProvider(config),
});

// Register PlayHT provider
VOICE_PROVIDER_REGISTRY.set('playht', {
  metadata: {
    name: 'playht',
    displayName: 'PlayHT',
    description:
      'Cost-effective AI voice generation with instant voice cloning',
    supportedLanguages: [...PLAYHT.SUPPORTED_LANGUAGES],
    voiceCount: 600,
    supportsCloning: true,
    supportsStreaming: true,
    costPer1000Chars: PLAYHT.COST_PER_1000_CHARS,
    features: {
      stability: false,
      similarity: false,
      style: false,
      speed: true,
    },
  },
  factory: (config: VoiceProviderConfig) => new PlayHTProvider(config),
});
// Additional voice providers will be added when implemented:
// - Deepgram
// - Azure
// - Google

// =============================================================================
// Voice Provider Registry Functions
// =============================================================================

/**
 * Get a voice provider registry entry by name
 */
export function getVoiceProviderEntry(
  name: VoiceProviderName,
): VoiceProviderRegistryEntry | undefined {
  return VOICE_PROVIDER_REGISTRY.get(name);
}

/**
 * Get metadata for a specific voice provider
 */
export function getVoiceProviderMetadata(
  providerName: VoiceProviderName,
): VoiceProviderMetadata | null {
  const entry = VOICE_PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata ?? null;
}

/**
 * Get metadata for all registered voice providers
 */
export function getAllVoiceProviderMetadata(): VoiceProviderMetadata[] {
  return Array.from(VOICE_PROVIDER_REGISTRY.values()).map(
    (entry) => entry.metadata,
  );
}

/**
 * Get all registered voice provider names
 */
export function getRegisteredVoiceProviderNames(): VoiceProviderName[] {
  return Array.from(VOICE_PROVIDER_REGISTRY.keys());
}

/**
 * Check if a voice provider is registered
 */
export function isVoiceProviderRegistered(
  name: string,
): name is VoiceProviderName {
  return VOICE_PROVIDER_REGISTRY.has(name as VoiceProviderName);
}

/**
 * Create a voice provider instance from the registry
 * This is a low-level function - prefer createAccountVoiceProvider for production use
 */
export function createVoiceProviderFromRegistry(
  name: VoiceProviderName,
  config: VoiceProviderConfig,
): VoiceGenerationProvider {
  const entry = VOICE_PROVIDER_REGISTRY.get(name);
  if (!entry) {
    throw new Error(`Voice provider not found: ${name}`);
  }
  return entry.factory(config);
}

/**
 * Register a new voice provider (for extensibility/testing)
 * Use with caution - prefer using built-in providers
 */
export function registerVoiceProvider(
  name: VoiceProviderName,
  metadata: VoiceProviderMetadata,
  factory: (config: VoiceProviderConfig) => VoiceGenerationProvider,
): void {
  VOICE_PROVIDER_REGISTRY.set(name, { metadata, factory });
}
