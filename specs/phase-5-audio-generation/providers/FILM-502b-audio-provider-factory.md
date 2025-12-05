# FILM-502b: Audio Provider Factory

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P0 (Critical for abstraction)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-108 (Audio Generation Package), FILM-501 (ElevenLabs), FILM-509 (Suno)
- **Blocks:** All audio generation actions

---

## Context

The Audio Provider Factory implements a registry pattern for voice and music generation providers, enabling dynamic provider selection based on user preferences or system configuration. This factory mirrors the video generation factory (FILM-402) to ensure consistent abstraction patterns across the codebase.

**Key Principle:** No vendor lock-in. Users can switch between providers (ElevenLabs ↔ PlayHT for voice, Suno ↔ Udio for music) without code changes.

---

## Specification

### Requirements

1. **Voice Provider Registry**
   - Register multiple TTS providers (ElevenLabs, PlayHT, Deepgram, etc.)
   - Support provider metadata (name, capabilities, pricing, languages)
   - Allow runtime provider registration for extensibility

2. **Music Provider Registry**
   - Register multiple music providers (Suno, Udio, Mubert)
   - Support provider metadata (genres, max duration, pricing)
   - Handle instrumental vs vocal generation capabilities

3. **Provider Instantiation**
   - Create provider instances with proper configuration
   - Load encrypted API keys from database (BYOK support)
   - Initialize providers with account-specific settings
   - Cache provider instances per account

4. **Provider Selection**
   - Get provider by name
   - Get default provider for account (per type: voice/music)
   - List all available providers
   - Check provider availability and health

### TypeScript Interfaces

```typescript
// packages/features/audio-generation/src/providers/factory.ts

import { z } from 'zod';

// ============================================
// VOICE PROVIDER TYPES
// ============================================

export type VoiceProviderName = 'elevenlabs' | 'playht' | 'deepgram' | 'azure' | 'google';

export interface VoiceProviderMetadata {
  name: VoiceProviderName;
  displayName: string;
  description: string;
  supportedLanguages: string[];
  voiceCount: number;
  supportsCloning: boolean;
  supportsStreaming: boolean;
  costPer1000Chars: number; // in cents
  features: {
    stability: boolean;
    similarity: boolean;
    style: boolean;
    speed: boolean;
  };
}

export interface VoiceProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

// ============================================
// MUSIC PROVIDER TYPES
// ============================================

export type MusicProviderName = 'suno' | 'udio' | 'mubert' | 'beatoven';

export interface MusicProviderMetadata {
  name: MusicProviderName;
  displayName: string;
  description: string;
  maxDuration: number; // seconds
  supportsVocals: boolean;
  supportsInstrumental: boolean;
  supportedGenres: string[];
  costPerGeneration: number; // in cents
}

export interface MusicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

// ============================================
// FACTORY OPTIONS
// ============================================

export interface AudioProviderFactoryOptions {
  accountId: string;
  webhookBaseUrl?: string;
}

export interface VoiceProviderFactoryOptions extends AudioProviderFactoryOptions {
  provider?: VoiceProviderName;
}

export interface MusicProviderFactoryOptions extends AudioProviderFactoryOptions {
  provider?: MusicProviderName;
}
```

### Factory Implementation

```typescript
// packages/features/audio-generation/src/providers/factory.ts

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt } from '@kit/shared/crypto';
import { ElevenLabsProvider } from './elevenlabs/elevenlabs-provider';
import { PlayHTProvider } from './playht/playht-provider';
import { SunoProvider } from './suno/suno-provider';
import { UdioProvider } from './udio/udio-provider';
import type {
  VoiceGenerationProvider,
  MusicGenerationProvider,
  VoiceProviderName,
  MusicProviderName,
  VoiceProviderMetadata,
  MusicProviderMetadata,
  VoiceProviderConfig,
  MusicProviderConfig,
} from './types';

// ============================================
// VOICE PROVIDER REGISTRY
// ============================================

const VOICE_PROVIDER_REGISTRY = new Map<string, {
  metadata: VoiceProviderMetadata;
  factory: (config: VoiceProviderConfig) => VoiceGenerationProvider;
}>([
  [
    'elevenlabs',
    {
      metadata: {
        name: 'elevenlabs',
        displayName: 'ElevenLabs',
        description: 'Premium AI voice synthesis with natural-sounding voices',
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'hi', 'ja', 'ko', 'zh', 'nl', 'tr', 'sv', 'id', 'ms', 'ru', 'ar'],
        voiceCount: 120,
        supportsCloning: true,
        supportsStreaming: true,
        costPer1000Chars: 30, // $0.30 per 1000 chars
        features: {
          stability: true,
          similarity: true,
          style: true,
          speed: true,
        },
      },
      factory: (config) => new ElevenLabsProvider(config),
    },
  ],
  [
    'playht',
    {
      metadata: {
        name: 'playht',
        displayName: 'PlayHT',
        description: 'Affordable AI voices with 600+ options and 140+ languages',
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', /* 140+ total */],
        voiceCount: 600,
        supportsCloning: true,
        supportsStreaming: true,
        costPer1000Chars: 15, // $0.015 per 1000 chars
        features: {
          stability: false,
          similarity: true,
          style: true,
          speed: true,
        },
      },
      factory: (config) => new PlayHTProvider(config),
    },
  ],
  // Additional providers can be registered here
]);

// ============================================
// MUSIC PROVIDER REGISTRY
// ============================================

const MUSIC_PROVIDER_REGISTRY = new Map<string, {
  metadata: MusicProviderMetadata;
  factory: (config: MusicProviderConfig) => MusicGenerationProvider;
}>([
  [
    'suno',
    {
      metadata: {
        name: 'suno',
        displayName: 'Suno',
        description: 'Full song generation with AI vocals and lyrics',
        maxDuration: 240, // 4 minutes
        supportsVocals: true,
        supportsInstrumental: true,
        supportedGenres: ['pop', 'rock', 'electronic', 'cinematic', 'orchestral', 'jazz', 'ambient', 'hip-hop'],
        costPerGeneration: 50, // $0.50 per generation
      },
      factory: (config) => new SunoProvider(config),
    },
  ],
  [
    'udio',
    {
      metadata: {
        name: 'udio',
        displayName: 'Udio',
        description: 'High-quality music with superior vocals and remix capabilities',
        maxDuration: 240,
        supportsVocals: true,
        supportsInstrumental: true,
        supportedGenres: ['pop', 'rock', 'electronic', 'cinematic', 'orchestral', 'jazz', 'ambient', 'hip-hop', 'metal', 'country'],
        costPerGeneration: 50,
      },
      factory: (config) => new UdioProvider(config),
    },
  ],
  [
    'mubert',
    {
      metadata: {
        name: 'mubert',
        displayName: 'Mubert',
        description: 'Generative streaming music, ideal for background tracks',
        maxDuration: 900, // 15 minutes
        supportsVocals: false,
        supportsInstrumental: true,
        supportedGenres: ['ambient', 'electronic', 'lofi', 'cinematic', 'corporate'],
        costPerGeneration: 25,
      },
      factory: (config) => new MubertProvider(config),
    },
  ],
]);

// ============================================
// PROVIDER CACHE
// ============================================

const voiceProviderCache = new Map<string, VoiceGenerationProvider>();
const musicProviderCache = new Map<string, MusicGenerationProvider>();

// ============================================
// VOICE PROVIDER FACTORY
// ============================================

export async function createVoiceProvider(
  options: VoiceProviderFactoryOptions
): Promise<VoiceGenerationProvider> {
  const { accountId, provider: providerName } = options;

  // Determine which provider to use
  const selectedProvider = providerName || (await getDefaultVoiceProvider(accountId));

  // Check cache
  const cacheKey = `${accountId}:${selectedProvider}`;
  const cached = voiceProviderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Get registry entry
  const entry = VOICE_PROVIDER_REGISTRY.get(selectedProvider);
  if (!entry) {
    throw new Error(`Voice provider not found: ${selectedProvider}`);
  }

  // Load configuration
  const config = await loadVoiceProviderConfig(accountId, selectedProvider);

  // Create and cache instance
  const providerInstance = entry.factory(config);
  voiceProviderCache.set(cacheKey, providerInstance);

  return providerInstance;
}

// ============================================
// MUSIC PROVIDER FACTORY
// ============================================

export async function createMusicProvider(
  options: MusicProviderFactoryOptions
): Promise<MusicGenerationProvider> {
  const { accountId, provider: providerName } = options;

  // Determine which provider to use
  const selectedProvider = providerName || (await getDefaultMusicProvider(accountId));

  // Check cache
  const cacheKey = `${accountId}:${selectedProvider}`;
  const cached = musicProviderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Get registry entry
  const entry = MUSIC_PROVIDER_REGISTRY.get(selectedProvider);
  if (!entry) {
    throw new Error(`Music provider not found: ${selectedProvider}`);
  }

  // Load configuration
  const config = await loadMusicProviderConfig(accountId, selectedProvider);

  // Create and cache instance
  const providerInstance = entry.factory(config);
  musicProviderCache.set(cacheKey, providerInstance);

  return providerInstance;
}

// ============================================
// METADATA ACCESSORS
// ============================================

export function getVoiceProviderMetadata(
  providerName: VoiceProviderName
): VoiceProviderMetadata | null {
  const entry = VOICE_PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata || null;
}

export function getMusicProviderMetadata(
  providerName: MusicProviderName
): MusicProviderMetadata | null {
  const entry = MUSIC_PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata || null;
}

export function getAllVoiceProviderMetadata(): VoiceProviderMetadata[] {
  return Array.from(VOICE_PROVIDER_REGISTRY.values()).map(entry => entry.metadata);
}

export function getAllMusicProviderMetadata(): MusicProviderMetadata[] {
  return Array.from(MUSIC_PROVIDER_REGISTRY.values()).map(entry => entry.metadata);
}

// ============================================
// AVAILABILITY CHECKS
// ============================================

export async function getAvailableVoiceProviders(
  accountId: string
): Promise<VoiceProviderMetadata[]> {
  const allProviders = getAllVoiceProviderMetadata();
  const available: VoiceProviderMetadata[] = [];

  for (const provider of allProviders) {
    const hasKey = await hasProviderApiKey(accountId, provider.name);
    if (hasKey) {
      available.push(provider);
    }
  }

  return available;
}

export async function getAvailableMusicProviders(
  accountId: string
): Promise<MusicProviderMetadata[]> {
  const allProviders = getAllMusicProviderMetadata();
  const available: MusicProviderMetadata[] = [];

  for (const provider of allProviders) {
    const hasKey = await hasProviderApiKey(accountId, provider.name);
    if (hasKey) {
      available.push(provider);
    }
  }

  return available;
}

// ============================================
// CACHE MANAGEMENT
// ============================================

export function clearAudioProviderCache(accountId?: string): void {
  if (accountId) {
    for (const key of voiceProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        voiceProviderCache.delete(key);
      }
    }
    for (const key of musicProviderCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        musicProviderCache.delete(key);
      }
    }
  } else {
    voiceProviderCache.clear();
    musicProviderCache.clear();
  }
}

// ============================================
// REGISTRATION (for extensibility)
// ============================================

export function registerVoiceProvider(
  name: string,
  metadata: VoiceProviderMetadata,
  factory: (config: VoiceProviderConfig) => VoiceGenerationProvider
): void {
  VOICE_PROVIDER_REGISTRY.set(name, { metadata, factory });
}

export function registerMusicProvider(
  name: string,
  metadata: MusicProviderMetadata,
  factory: (config: MusicProviderConfig) => MusicGenerationProvider
): void {
  MUSIC_PROVIDER_REGISTRY.set(name, { metadata, factory });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function loadVoiceProviderConfig(
  accountId: string,
  providerName: string
): Promise<VoiceProviderConfig> {
  const client = getSupabaseServerClient();

  // Try BYOK key first
  const { data: userKey } = await client
    .from('external_api_keys')
    .select('encrypted_key, provider_config')
    .eq('account_id', accountId)
    .eq('provider', providerName)
    .eq('is_active', true)
    .single();

  let apiKey: string;

  if (userKey?.encrypted_key) {
    apiKey = await decrypt(userKey.encrypted_key);
  } else {
    // Fall back to platform key
    const platformKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
    if (!platformKey) {
      throw new Error(
        `No API key configured for ${providerName}. Please add your API key in settings.`
      );
    }
    apiKey = platformKey;
  }

  return {
    apiKey,
    baseUrl: userKey?.provider_config?.baseUrl,
    timeout: userKey?.provider_config?.timeout ?? 30000,
    maxRetries: userKey?.provider_config?.maxRetries ?? 3,
  };
}

async function loadMusicProviderConfig(
  accountId: string,
  providerName: string
): Promise<MusicProviderConfig> {
  // Same pattern as voice provider
  return loadVoiceProviderConfig(accountId, providerName) as Promise<MusicProviderConfig>;
}

async function getDefaultVoiceProvider(accountId: string): Promise<VoiceProviderName> {
  const client = getSupabaseServerClient();

  const { data: account } = await client
    .from('accounts')
    .select('settings')
    .eq('id', accountId)
    .single();

  if (account?.settings?.defaultVoiceProvider) {
    return account.settings.defaultVoiceProvider as VoiceProviderName;
  }

  // Fall back to first available
  const available = await getAvailableVoiceProviders(accountId);
  if (available.length === 0) {
    throw new Error('No voice generation providers available');
  }

  return available[0].name;
}

async function getDefaultMusicProvider(accountId: string): Promise<MusicProviderName> {
  const client = getSupabaseServerClient();

  const { data: account } = await client
    .from('accounts')
    .select('settings')
    .eq('id', accountId)
    .single();

  if (account?.settings?.defaultMusicProvider) {
    return account.settings.defaultMusicProvider as MusicProviderName;
  }

  // Fall back to first available
  const available = await getAvailableMusicProviders(accountId);
  if (available.length === 0) {
    throw new Error('No music generation providers available');
  }

  return available[0].name;
}

async function hasProviderApiKey(
  accountId: string,
  providerName: string
): Promise<boolean> {
  const client = getSupabaseServerClient();

  // Check for user's BYOK key
  const { data: userKey } = await client
    .from('external_api_keys')
    .select('id')
    .eq('account_id', accountId)
    .eq('provider', providerName)
    .eq('is_active', true)
    .single();

  if (userKey) return true;

  // Check for platform key
  const platformKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
  return !!platformKey;
}
```

---

## File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/audio-generation/src/providers/factory.ts` |
| CREATE | `packages/features/audio-generation/src/providers/registry.ts` |
| MODIFY | `packages/features/audio-generation/src/providers/index.ts` |
| MODIFY | `packages/features/audio-generation/src/lib/types.ts` |

---

## Acceptance Criteria

- [ ] `createVoiceProvider()` returns configured provider instance
- [ ] `createMusicProvider()` returns configured provider instance
- [ ] Factory uses cached instance on subsequent calls
- [ ] Factory loads BYOK keys when available
- [ ] Factory falls back to platform keys
- [ ] `getVoiceProviderMetadata()` returns correct metadata
- [ ] `getMusicProviderMetadata()` returns correct metadata
- [ ] `getAvailableVoiceProviders()` returns only configured providers
- [ ] `getAvailableMusicProviders()` returns only configured providers
- [ ] `clearAudioProviderCache()` invalidates cached instances
- [ ] `registerVoiceProvider()` allows adding new providers at runtime
- [ ] `registerMusicProvider()` allows adding new providers at runtime

---

## Test Plan

### Unit Tests
- [ ] Test voice provider creation with valid config
- [ ] Test music provider creation with valid config
- [ ] Test cache behavior (same instance returned)
- [ ] Test BYOK key loading
- [ ] Test platform key fallback
- [ ] Test error when no key available
- [ ] Test metadata accessor functions
- [ ] Test availability check functions
- [ ] Test cache clearing

### Integration Tests
- [ ] Test with real Supabase connection
- [ ] Test provider switching per account

---

## Security Considerations

- API keys always stored encrypted
- Keys decrypted in memory only when needed
- Provider instances never serialized/logged
- Cache cleared on key rotation

---

## Provider Comparison

| Feature | ElevenLabs | PlayHT | Deepgram |
|---------|------------|--------|----------|
| Cost/1K chars | $0.30 | $0.015 | $0.011 |
| Voice Count | 120+ | 600+ | 50+ |
| Cloning | ✅ | ✅ | ❌ |
| Streaming | ✅ | ✅ | ✅ |
| Languages | 20+ | 140+ | 30+ |

| Feature | Suno | Udio | Mubert |
|---------|------|------|--------|
| Cost/gen | $0.50 | $0.50 | $0.25 |
| Max Duration | 4 min | 4 min | 15 min |
| Vocals | ✅ | ✅ | ❌ |
| Remix | ❌ | ✅ | ❌ |
| Streaming | ❌ | ❌ | ✅ |

---

## References

- **FILM-402**: Video Provider Factory (pattern reference)
- **FILM-501**: ElevenLabs Provider
- **FILM-509**: Suno Provider
- **Constitution**: Section 4.2 (API Keys)
