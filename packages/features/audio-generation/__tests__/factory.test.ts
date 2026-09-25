import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ELEVENLABS } from '../src/lib/constants';
import {
  NoAPIKeyError,
  VoiceProviderNotFoundError,
} from '../src/providers/errors';
import {
  clearAccountProviderCache,
  clearProviderCache,
  createVoiceProvider,
  getAllVoiceProviderMetadata,
  getAvailableVoiceProviders,
  getVoiceProvider,
  getVoiceProviderMetadata,
} from '../src/providers/factory';
import {
  createVoiceProviderFromRegistry,
  getRegisteredVoiceProviderNames,
  isVoiceProviderRegistered,
  registerVoiceProvider,
} from '../src/providers/registry';

// Mock the config-loader since it depends on server-side imports
vi.mock('../src/providers/config-loader', () => ({
  loadVoiceProviderConfig: vi.fn(),
  hasVoiceProviderApiKey: vi.fn(),
}));

describe('Audio Provider Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProviderCache();
    clearAccountProviderCache();
  });

  afterEach(() => {
    clearProviderCache();
    clearAccountProviderCache();
  });

  // ==========================================================================
  // Voice Provider Registry Tests
  // ==========================================================================

  describe('Voice Provider Registry', () => {
    describe('isVoiceProviderRegistered', () => {
      it('should return true for registered provider', () => {
        expect(isVoiceProviderRegistered('elevenlabs')).toBe(true);
      });

      it('should return false for unregistered provider', () => {
        expect(isVoiceProviderRegistered('unknown')).toBe(false);
      });
    });

    describe('getRegisteredVoiceProviderNames', () => {
      it('should return all registered voice provider names', () => {
        const names = getRegisteredVoiceProviderNames();
        expect(names).toContain('elevenlabs');
        expect(Array.isArray(names)).toBe(true);
      });
    });

    describe('getVoiceProviderMetadata', () => {
      it('should return metadata for registered provider', () => {
        const metadata = getVoiceProviderMetadata('elevenlabs');
        expect(metadata).not.toBeNull();
        expect(metadata?.name).toBe('elevenlabs');
        expect(metadata?.displayName).toBe('ElevenLabs');
        expect(metadata?.supportsCloning).toBe(true);
        expect(metadata?.supportsStreaming).toBe(true);
        expect(metadata?.costPer1000Chars).toBe(ELEVENLABS.COST_PER_1000_CHARS);
      });

      it('should return null for unregistered provider', () => {
        const metadata = getVoiceProviderMetadata('unknown' as 'elevenlabs');
        expect(metadata).toBeNull();
      });
    });

    describe('getAllVoiceProviderMetadata', () => {
      it('should return metadata for all registered providers', () => {
        const allMetadata = getAllVoiceProviderMetadata();
        expect(Array.isArray(allMetadata)).toBe(true);
        expect(allMetadata.length).toBeGreaterThan(0);
        expect(allMetadata.some((m) => m.name === 'elevenlabs')).toBe(true);
      });
    });

    describe('createVoiceProviderFromRegistry', () => {
      it('should create voice provider with valid config', () => {
        const provider = createVoiceProviderFromRegistry('elevenlabs', {
          apiKey: 'test-api-key',
        });
        expect(provider).toBeDefined();
        expect(provider.name).toBe('elevenlabs');
        expect(provider.supportsCloning).toBe(true);
      });

      it('should throw error for unregistered provider', () => {
        expect(() =>
          createVoiceProviderFromRegistry('unknown' as 'elevenlabs', {
            apiKey: 'test',
          }),
        ).toThrow('Voice provider not found: unknown');
      });
    });

    describe('registerVoiceProvider', () => {
      it('should allow registering custom providers', () => {
        const mockFactory = vi.fn().mockReturnValue({
          name: 'custom',
          supportedLanguages: ['en'],
          supportsCloning: false,
          supportsStreaming: false,
          generateVoice: vi.fn(),
          getVoices: vi.fn(),
          estimateCost: vi.fn(),
          getRateLimits: vi.fn(),
        });

        registerVoiceProvider(
          'playht' as 'elevenlabs', // Using a known type for testing
          {
            name: 'playht',
            displayName: 'PlayHT',
            description: 'Custom provider',
            supportedLanguages: ['en'],
            supportsCloning: false,
            supportsStreaming: true,
            costPer1000Chars: 15,
            features: {
              stability: false,
              similarity: false,
              style: false,
              speed: true,
            },
          },
          mockFactory,
        );

        expect(isVoiceProviderRegistered('playht')).toBe(true);
        const metadata = getVoiceProviderMetadata('playht');
        expect(metadata?.displayName).toBe('PlayHT');
      });
    });
  });

  // ==========================================================================
  // Basic Factory Tests (Config-based)
  // ==========================================================================

  describe('Basic Factory (config-based)', () => {
    describe('createVoiceProvider', () => {
      it('should create provider with valid config', () => {
        const provider = createVoiceProvider('elevenlabs', {
          apiKey: 'test-api-key',
        });
        expect(provider).toBeDefined();
        expect(provider.name).toBe('elevenlabs');
      });

      it('should return cached instance for same config', () => {
        const config = { apiKey: 'test-api-key' };
        const provider1 = createVoiceProvider('elevenlabs', config);
        const provider2 = createVoiceProvider('elevenlabs', config);
        expect(provider1).toBe(provider2);
      });

      it('should create new instance for different config', () => {
        const provider1 = createVoiceProvider('elevenlabs', {
          apiKey: 'key-1',
        });
        const provider2 = createVoiceProvider('elevenlabs', {
          apiKey: 'key-2',
        });
        expect(provider1).not.toBe(provider2);
      });
    });

    describe('getVoiceProvider', () => {
      it('should return cached provider if exists', () => {
        const config = { apiKey: 'test-api-key' };
        const created = createVoiceProvider('elevenlabs', config);
        const retrieved = getVoiceProvider('elevenlabs');
        expect(retrieved).toBe(created);
      });

      it('should return undefined if not cached', () => {
        clearProviderCache();
        const retrieved = getVoiceProvider('elevenlabs');
        expect(retrieved).toBeUndefined();
      });
    });

    describe('clearProviderCache', () => {
      it('should clear all cached providers', () => {
        createVoiceProvider('elevenlabs', { apiKey: 'test' });

        clearProviderCache();

        expect(getVoiceProvider('elevenlabs')).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // Error Classes Tests
  // ==========================================================================

  describe('Error Classes', () => {
    describe('VoiceProviderNotFoundError', () => {
      it('should have correct properties', () => {
        const error = new VoiceProviderNotFoundError('unknown');
        expect(error.message).toBe('Voice provider not found: unknown');
        expect(error.name).toBe('VoiceProviderNotFoundError');
        expect(error.code).toBe('VOICE_PROVIDER_NOT_FOUND');
      });
    });

    describe('NoAPIKeyError', () => {
      it('should have correct properties', () => {
        const error = new NoAPIKeyError('elevenlabs');
        expect(error.message).toContain('No API key configured for elevenlabs');
        expect(error.name).toBe('NoAPIKeyError');
        expect(error.code).toBe('NO_API_KEY');
        expect(error.providerName).toBe('elevenlabs');
      });
    });
  });

  // ==========================================================================
  // Provider Metadata Tests
  // ==========================================================================

  describe('Provider Metadata', () => {
    describe('Voice Provider Metadata', () => {
      it('should have all required fields for ElevenLabs', () => {
        const metadata = getVoiceProviderMetadata('elevenlabs');
        expect(metadata).toMatchObject({
          name: 'elevenlabs',
          displayName: 'ElevenLabs',
          supportsCloning: true,
          supportsStreaming: true,
          features: {
            stability: true,
            similarity: true,
            style: true,
            speed: true,
          },
        });
        expect(metadata?.supportedLanguages.length).toBeGreaterThan(0);
        expect(metadata?.costPer1000Chars).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // Availability Check Tests (with mocked config-loader)
  // ==========================================================================

  describe('Provider Availability', () => {
    describe('getAvailableVoiceProviders', () => {
      it('should return only providers with API keys', async () => {
        const { hasVoiceProviderApiKey } = await import(
          '../src/providers/config-loader'
        );
        vi.mocked(hasVoiceProviderApiKey).mockResolvedValue(true);

        const available = await getAvailableVoiceProviders('test-account');
        expect(available.length).toBeGreaterThan(0);
        expect(available[0]?.name).toBe('elevenlabs');
      });

      it('should return empty array when no API keys configured', async () => {
        const { hasVoiceProviderApiKey } = await import(
          '../src/providers/config-loader'
        );
        vi.mocked(hasVoiceProviderApiKey).mockResolvedValue(false);

        const available = await getAvailableVoiceProviders('test-account');
        expect(available).toHaveLength(0);
      });
    });
  });

  // ==========================================================================
  // Account-Based Cache Tests
  // ==========================================================================

  describe('Account Provider Cache', () => {
    describe('clearAccountProviderCache', () => {
      it('should clear all caches when no accountId provided', () => {
        // We can't easily test this without the actual createAccountVoiceProvider
        // which requires server-side dependencies
        // This test just verifies the function doesn't throw
        expect(() => clearAccountProviderCache()).not.toThrow();
      });

      it('should accept accountId parameter', () => {
        expect(() => clearAccountProviderCache('test-account')).not.toThrow();
      });
    });
  });
});
