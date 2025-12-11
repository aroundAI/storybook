import { ELEVENLABS, SUNO, UDIO } from '../lib/constants';
import type {
  MusicProviderConfig,
  MusicProviderMetadata,
  MusicProviderName,
  VoiceProviderConfig,
  VoiceProviderMetadata,
  VoiceProviderName,
} from '../lib/types';
import type { MusicGenerationProvider, VoiceGenerationProvider } from './base';
import { ElevenLabsProvider } from './elevenlabs';
import { SunoProvider } from './suno';
import { UdioProvider } from './udio';

/**
 * Voice provider registry entry containing metadata and factory function
 */
export interface VoiceProviderRegistryEntry {
  metadata: VoiceProviderMetadata;
  factory: (config: VoiceProviderConfig) => VoiceGenerationProvider;
}

/**
 * Music provider registry entry containing metadata and factory function
 */
export interface MusicProviderRegistryEntry {
  metadata: MusicProviderMetadata;
  factory: (config: MusicProviderConfig) => MusicGenerationProvider;
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
// Additional voice providers will be added when implemented:
// - PlayHT
// - Deepgram
// - Azure
// - Google

/**
 * Music provider registry containing metadata and factories for all music providers
 */
const MUSIC_PROVIDER_REGISTRY = new Map<
  MusicProviderName,
  MusicProviderRegistryEntry
>();

// Register Suno provider
MUSIC_PROVIDER_REGISTRY.set('suno', {
  metadata: {
    name: 'suno',
    displayName: 'Suno',
    description: 'Full song generation with AI vocals and lyrics',
    maxDuration: SUNO.MAX_DURATION,
    supportsVocals: true,
    supportsInstrumental: true,
    supportedGenres: [...SUNO.SUPPORTED_GENRES],
    costPerGeneration: SUNO.COST_PER_GENERATION,
  },
  factory: (config: MusicProviderConfig) => new SunoProvider(config),
});

// Register Udio provider
MUSIC_PROVIDER_REGISTRY.set('udio', {
  metadata: {
    name: 'udio',
    displayName: 'Udio',
    description: 'High-quality AI music with vocals and extensions',
    maxDuration: UDIO.MAX_DURATION,
    supportsVocals: true,
    supportsInstrumental: true,
    supportedGenres: [...UDIO.SUPPORTED_GENRES],
    costPerGeneration: UDIO.COST_PER_GENERATION,
  },
  factory: (config: MusicProviderConfig) => new UdioProvider(config),
});

// Additional music providers will be added when implemented:
// - Mubert
// - Beatoven

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

// =============================================================================
// Music Provider Registry Functions
// =============================================================================

/**
 * Get a music provider registry entry by name
 */
export function getMusicProviderEntry(
  name: MusicProviderName,
): MusicProviderRegistryEntry | undefined {
  return MUSIC_PROVIDER_REGISTRY.get(name);
}

/**
 * Get metadata for a specific music provider
 */
export function getMusicProviderMetadata(
  providerName: MusicProviderName,
): MusicProviderMetadata | null {
  const entry = MUSIC_PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata ?? null;
}

/**
 * Get metadata for all registered music providers
 */
export function getAllMusicProviderMetadata(): MusicProviderMetadata[] {
  return Array.from(MUSIC_PROVIDER_REGISTRY.values()).map(
    (entry) => entry.metadata,
  );
}

/**
 * Get all registered music provider names
 */
export function getRegisteredMusicProviderNames(): MusicProviderName[] {
  return Array.from(MUSIC_PROVIDER_REGISTRY.keys());
}

/**
 * Check if a music provider is registered
 */
export function isMusicProviderRegistered(
  name: string,
): name is MusicProviderName {
  return MUSIC_PROVIDER_REGISTRY.has(name as MusicProviderName);
}

/**
 * Create a music provider instance from the registry
 * This is a low-level function - prefer createAccountMusicProvider for production use
 */
export function createMusicProviderFromRegistry(
  name: MusicProviderName,
  config: MusicProviderConfig,
): MusicGenerationProvider {
  const entry = MUSIC_PROVIDER_REGISTRY.get(name);
  if (!entry) {
    throw new Error(`Music provider not found: ${name}`);
  }
  return entry.factory(config);
}

/**
 * Register a new music provider (for extensibility/testing)
 * Use with caution - prefer using built-in providers
 */
export function registerMusicProvider(
  name: MusicProviderName,
  metadata: MusicProviderMetadata,
  factory: (config: MusicProviderConfig) => MusicGenerationProvider,
): void {
  MUSIC_PROVIDER_REGISTRY.set(name, { metadata, factory });
}
