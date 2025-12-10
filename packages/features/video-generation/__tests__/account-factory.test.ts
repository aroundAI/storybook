import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAccountProviderCache,
  createAccountVideoProvider,
  getAllProviderMetadata,
  getAvailableProviders,
  getProviderMetadata,
  isProviderAvailable,
  NoAPIKeyError,
  ProviderNotFoundError,
} from '../src/providers';

// Mock the config-loader module
vi.mock('../src/providers/config-loader', () => ({
  loadProviderConfig: vi.fn(),
  hasProviderApiKey: vi.fn(),
}));

// Import mocked functions for manipulation
import {
  hasProviderApiKey,
  loadProviderConfig,
} from '../src/providers/config-loader';

const mockedLoadProviderConfig = vi.mocked(loadProviderConfig);
const mockedHasProviderApiKey = vi.mocked(hasProviderApiKey);

describe('Account-Based Provider Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAccountProviderCache();
  });

  afterEach(() => {
    clearAccountProviderCache();
  });

  describe('createAccountVideoProvider', () => {
    it('should create provider with BYOK configuration', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'user-byok-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('kling');
      expect(mockedLoadProviderConfig).toHaveBeenCalledWith(
        'account-123',
        'kling',
        undefined,
      );
    });

    it('should pass webhookBaseUrl to config loader', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://custom.example.com/api/generation/webhooks/runway',
      });

      await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'runway',
        webhookBaseUrl: 'https://custom.example.com',
      });

      expect(mockedLoadProviderConfig).toHaveBeenCalledWith(
        'account-123',
        'runway',
        'https://custom.example.com',
      );
    });

    it('should cache provider instances per account when config unchanged', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider1 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      const provider2 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Same instance should be returned when config hash matches
      expect(provider1).toBe(provider2);
      // Config is loaded each time to compute hash for validation
      expect(mockedLoadProviderConfig).toHaveBeenCalledTimes(2);
    });

    it('should create new provider instance when config changes', async () => {
      // First call with original key
      mockedLoadProviderConfig.mockResolvedValueOnce({
        apiKey: 'original-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider1 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Second call with updated key (simulating BYOK key update)
      mockedLoadProviderConfig.mockResolvedValueOnce({
        apiKey: 'updated-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider2 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Different instances because config hash changed
      expect(provider1).not.toBe(provider2);
    });

    it('should create separate instances for different accounts', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider1 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      const provider2 = await createAccountVideoProvider({
        accountId: 'account-456',
        provider: 'kling',
      });

      // Different instances for different accounts
      expect(provider1).not.toBe(provider2);
      expect(mockedLoadProviderConfig).toHaveBeenCalledTimes(2);
    });

    it('should create separate instances for different providers', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const klingProvider = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      const runwayProvider = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'runway',
      });

      expect(klingProvider.name).toBe('kling');
      expect(runwayProvider.name).toBe('runway');
      expect(klingProvider).not.toBe(runwayProvider);
    });

    it('should throw ProviderNotFoundError for unknown provider', async () => {
      await expect(
        createAccountVideoProvider({
          accountId: 'account-123',
          provider: 'unknown' as never,
        }),
      ).rejects.toThrow(ProviderNotFoundError);
    });

    it('should use first available provider when none specified', async () => {
      // Mock kling as available
      mockedHasProviderApiKey.mockResolvedValue(true);
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      const provider = await createAccountVideoProvider({
        accountId: 'account-123',
        // No provider specified
      });

      expect(provider).toBeDefined();
      expect(mockedHasProviderApiKey).toHaveBeenCalled();
    });
  });

  describe('clearAccountProviderCache', () => {
    it('should clear specific account cache', async () => {
      let callCount = 0;
      const createMockConfig = () => ({
        apiKey: `test-key-${++callCount}`,
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      mockedLoadProviderConfig.mockImplementation(async () => createMockConfig());

      // Create cached providers for two accounts
      const provider123First = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });
      const provider456First = await createAccountVideoProvider({
        accountId: 'account-456',
        provider: 'kling',
      });

      // Clear only account-123
      clearAccountProviderCache('account-123');

      // Create new provider for account-123 - should create new instance (cache cleared + new config hash)
      const provider123Second = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Should be different instance because cache was cleared and config changed
      expect(provider123First).not.toBe(provider123Second);

      // Create for account-456 - should still be different (config hash changed)
      // but this tests that the account-456 cache entry still exists
      const provider456Second = await createAccountVideoProvider({
        accountId: 'account-456',
        provider: 'kling',
      });

      // Different because config hash changed (callCount incremented)
      expect(provider456First).not.toBe(provider456Second);
    });

    it('should allow cache to work after clearing', async () => {
      // Use consistent config for cache to work
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'consistent-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      // Create provider
      const provider1 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Clear cache
      clearAccountProviderCache('account-123');

      // Create again - new instance but cache rebuilt
      const provider2 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Different instance after cache clear
      expect(provider1).not.toBe(provider2);

      // Third call should use cache (same config hash)
      const provider3 = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Same instance from cache
      expect(provider2).toBe(provider3);
    });

    it('should clear all caches when no account specified', async () => {
      mockedLoadProviderConfig.mockResolvedValue({
        apiKey: 'test-key',
        webhookUrl: 'https://app.example.com/api/generation/webhooks/kling',
      });

      // Create cached providers
      const provider123First = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });
      const provider456First = await createAccountVideoProvider({
        accountId: 'account-456',
        provider: 'kling',
      });

      // Clear all
      clearAccountProviderCache();

      // Recreate both - should create new instances (cache was cleared)
      const provider123Second = await createAccountVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });
      const provider456Second = await createAccountVideoProvider({
        accountId: 'account-456',
        provider: 'kling',
      });

      // New instances after cache clear (even with same config hash, cache entry is gone)
      expect(provider123First).not.toBe(provider123Second);
      expect(provider456First).not.toBe(provider456Second);
    });
  });

  describe('getProviderMetadata', () => {
    it('should return metadata for Kling provider', () => {
      const metadata = getProviderMetadata('kling');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('kling');
      expect(metadata?.displayName).toBe('Kling AI');
      expect(metadata?.maxDuration).toBe(10);
      expect(metadata?.minDuration).toBe(5);
      expect(metadata?.supportedAspectRatios).toContain('16:9');
      expect(metadata?.supportsImageToVideo).toBe(true);
    });

    it('should return metadata for Runway provider', () => {
      const metadata = getProviderMetadata('runway');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('runway');
      expect(metadata?.displayName).toBe('Runway Gen-3');
      expect(metadata?.maxDuration).toBe(18);
    });

    it('should return metadata for Hailuo provider', () => {
      const metadata = getProviderMetadata('hailuo');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('hailuo');
      expect(metadata?.displayName).toBe('Hailuo (MiniMax)');
      expect(metadata?.maxDuration).toBe(6);
    });

    it('should return metadata for Luma provider', () => {
      const metadata = getProviderMetadata('luma');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('luma');
      expect(metadata?.displayName).toBe('Luma AI');
      expect(metadata?.maxDuration).toBe(5);
    });

    it('should return null for unknown provider', () => {
      const metadata = getProviderMetadata('unknown' as never);

      expect(metadata).toBeNull();
    });
  });

  describe('getAllProviderMetadata', () => {
    it('should return all registered providers', () => {
      const allProviders = getAllProviderMetadata();

      expect(allProviders).toBeInstanceOf(Array);
      expect(allProviders.length).toBe(4);

      const names = allProviders.map((p) => p.name);
      expect(names).toContain('kling');
      expect(names).toContain('runway');
      expect(names).toContain('hailuo');
      expect(names).toContain('luma');
    });

    it('should include required fields in metadata', () => {
      const allProviders = getAllProviderMetadata();

      for (const provider of allProviders) {
        expect(provider.name).toBeDefined();
        expect(provider.displayName).toBeDefined();
        expect(provider.description).toBeDefined();
        expect(provider.supportedAspectRatios).toBeInstanceOf(Array);
        expect(provider.maxDuration).toBeGreaterThan(0);
        expect(provider.minDuration).toBeGreaterThan(0);
        expect(typeof provider.supportsImageToVideo).toBe('boolean');
        expect(provider.costPerSecond).toBeDefined();
        expect(provider.costPerSecond.standard).toBeGreaterThan(0);
        expect(provider.costPerSecond.professional).toBeGreaterThan(0);
      }
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when provider has BYOK key', async () => {
      mockedHasProviderApiKey.mockResolvedValue(true);

      const available = await isProviderAvailable('account-123', 'kling');

      expect(available).toBe(true);
      expect(mockedHasProviderApiKey).toHaveBeenCalledWith(
        'account-123',
        'kling',
      );
    });

    it('should return false when provider has no key', async () => {
      mockedHasProviderApiKey.mockResolvedValue(false);

      const available = await isProviderAvailable('account-123', 'runway');

      expect(available).toBe(false);
    });

    it('should return false for unknown provider', async () => {
      const available = await isProviderAvailable(
        'account-123',
        'unknown' as never,
      );

      expect(available).toBe(false);
      // Should not even check for API key
      expect(mockedHasProviderApiKey).not.toHaveBeenCalled();
    });
  });

  describe('getAvailableProviders', () => {
    it('should return only providers with API keys', async () => {
      // Mock: kling and hailuo have keys, runway and luma do not
      mockedHasProviderApiKey.mockImplementation(
        async (_accountId: string, provider: string) => {
          return provider === 'kling' || provider === 'hailuo';
        },
      );

      const available = await getAvailableProviders('account-123');

      expect(available.length).toBe(2);
      const names = available.map((p) => p.name);
      expect(names).toContain('kling');
      expect(names).toContain('hailuo');
      expect(names).not.toContain('runway');
      expect(names).not.toContain('luma');
    });

    it('should return empty array when no providers available', async () => {
      mockedHasProviderApiKey.mockResolvedValue(false);

      const available = await getAvailableProviders('account-123');

      expect(available).toEqual([]);
    });

    it('should return all providers when all have keys', async () => {
      mockedHasProviderApiKey.mockResolvedValue(true);

      const available = await getAvailableProviders('account-123');

      expect(available.length).toBe(4);
    });
  });

  describe('Error Classes', () => {
    it('ProviderNotFoundError should have correct properties', () => {
      const error = new ProviderNotFoundError('unknown-provider');

      expect(error.name).toBe('ProviderNotFoundError');
      expect(error.code).toBe('PROVIDER_NOT_FOUND');
      expect(error.message).toBe('Video provider not found: unknown-provider');
    });

    it('NoAPIKeyError should have correct properties', () => {
      const error = new NoAPIKeyError('kling');

      expect(error.name).toBe('NoAPIKeyError');
      expect(error.code).toBe('NO_API_KEY');
      expect(error.providerName).toBe('kling');
      expect(error.message).toContain('kling');
      expect(error.message).toContain('API key');
    });
  });
});
