import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import mocked functions
import { decrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Import the module under test
import {
  hasProviderApiKey,
  loadProviderConfig,
} from '../src/providers/config-loader';
import { NoAPIKeyError } from '../src/providers/errors';

// Mock dependencies before importing the module under test
vi.mock('@kit/shared/crypto', () => ({
  decrypt: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const mockedDecrypt = vi.mocked(decrypt);
const mockedGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

describe('Config Loader', () => {
  // Store original env
  const originalEnv = { ...process.env };

  // Mock Supabase client
  const mockSingle = vi.fn();
  const mockEq = vi.fn(() => ({ eq: mockEq, single: mockSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockClient = { from: mockFrom };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    process.env = { ...originalEnv };
    // Clear platform keys
    delete process.env.KLING_API_KEY;
    delete process.env.RUNWAY_API_KEY;
    delete process.env.HAILUO_API_KEY;
    delete process.env.LUMA_API_KEY;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    // Setup default mock chain
    mockedGetSupabaseServerClient.mockReturnValue(mockClient as never);
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadProviderConfig', () => {
    describe('BYOK key loading', () => {
      it('should load and decrypt BYOK key from database', async () => {
        // Mock database returns encrypted key
        mockSingle.mockResolvedValue({
          data: { encrypted_key: 'encrypted-byok-key' },
          error: null,
        });
        mockedDecrypt.mockResolvedValue('decrypted-api-key');
        process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';

        const config = await loadProviderConfig('account-123', 'kling');

        expect(config.apiKey).toBe('decrypted-api-key');
        expect(config.webhookUrl).toBe(
          'https://app.example.com/api/generation/webhooks/kling',
        );
        expect(mockedDecrypt).toHaveBeenCalledWith('encrypted-byok-key');
        expect(mockFrom).toHaveBeenCalledWith('external_api_keys');
      });

      it('should query with correct filters', async () => {
        mockSingle.mockResolvedValue({
          data: { encrypted_key: 'encrypted-key' },
          error: null,
        });
        mockedDecrypt.mockResolvedValue('api-key');

        await loadProviderConfig('account-456', 'runway');

        // Verify the query chain was called with correct parameters
        expect(mockSelect).toHaveBeenCalledWith('encrypted_key');
        expect(mockEq).toHaveBeenCalledWith('account_id', 'account-456');
        expect(mockEq).toHaveBeenCalledWith('provider', 'runway');
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
      });
    });

    describe('Platform key fallback', () => {
      it('should use platform key when no BYOK key exists', async () => {
        // Mock database returns no key
        mockSingle.mockResolvedValue({
          data: null,
          error: null,
        });
        process.env.KLING_API_KEY = 'platform-kling-key';
        process.env.NEXT_PUBLIC_SITE_URL = 'https://platform.example.com';

        const config = await loadProviderConfig('account-123', 'kling');

        expect(config.apiKey).toBe('platform-kling-key');
        expect(config.webhookUrl).toBe(
          'https://platform.example.com/api/generation/webhooks/kling',
        );
        expect(mockedDecrypt).not.toHaveBeenCalled();
      });

      it('should use correct env var for each provider', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });

        // Test each provider's env var mapping
        const providers = [
          { name: 'kling', envVar: 'KLING_API_KEY', key: 'kling-key' },
          { name: 'runway', envVar: 'RUNWAY_API_KEY', key: 'runway-key' },
          { name: 'hailuo', envVar: 'HAILUO_API_KEY', key: 'hailuo-key' },
          { name: 'luma', envVar: 'LUMA_API_KEY', key: 'luma-key' },
        ] as const;

        for (const { name, envVar, key } of providers) {
          process.env[envVar] = key;
          const config = await loadProviderConfig('account-123', name);
          expect(config.apiKey).toBe(key);
          delete process.env[envVar];
        }
      });
    });

    describe('Error handling', () => {
      it('should throw NoAPIKeyError when no key is available', async () => {
        // No BYOK key in database
        mockSingle.mockResolvedValue({
          data: null,
          error: null,
        });
        // No platform key in env
        delete process.env.KLING_API_KEY;

        await expect(
          loadProviderConfig('account-123', 'kling'),
        ).rejects.toThrow(NoAPIKeyError);
      });

      it('should include provider name in NoAPIKeyError', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });

        try {
          await loadProviderConfig('account-123', 'runway');
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(NoAPIKeyError);
          expect((error as NoAPIKeyError).providerName).toBe('runway');
        }
      });
    });

    describe('Webhook URL generation', () => {
      beforeEach(() => {
        mockSingle.mockResolvedValue({
          data: { encrypted_key: 'encrypted-key' },
          error: null,
        });
        mockedDecrypt.mockResolvedValue('api-key');
      });

      it('should use custom webhookBaseUrl when provided', async () => {
        const config = await loadProviderConfig(
          'account-123',
          'kling',
          'https://custom.example.com',
        );

        expect(config.webhookUrl).toBe(
          'https://custom.example.com/api/generation/webhooks/kling',
        );
      });

      it('should use NEXT_PUBLIC_SITE_URL as fallback', async () => {
        process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example.com';

        const config = await loadProviderConfig('account-123', 'runway');

        expect(config.webhookUrl).toBe(
          'https://site.example.com/api/generation/webhooks/runway',
        );
      });

      it('should handle missing base URL gracefully', async () => {
        delete process.env.NEXT_PUBLIC_SITE_URL;

        const config = await loadProviderConfig('account-123', 'hailuo');

        expect(config.webhookUrl).toBe('/api/generation/webhooks/hailuo');
      });

      it('should generate correct webhook path for each provider', async () => {
        process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';

        const providers = ['kling', 'runway', 'hailuo', 'luma'] as const;

        for (const provider of providers) {
          const config = await loadProviderConfig('account-123', provider);
          expect(config.webhookUrl).toBe(
            `https://app.example.com/api/generation/webhooks/${provider}`,
          );
        }
      });
    });
  });

  describe('hasProviderApiKey', () => {
    describe('BYOK key detection', () => {
      it('should return true when BYOK key exists', async () => {
        mockSingle.mockResolvedValue({
          data: { id: 'key-123' },
          error: null,
        });

        const hasKey = await hasProviderApiKey('account-123', 'kling');

        expect(hasKey).toBe(true);
        expect(mockSelect).toHaveBeenCalledWith('id');
      });

      it('should query with correct filters', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });

        await hasProviderApiKey('account-456', 'runway');

        expect(mockFrom).toHaveBeenCalledWith('external_api_keys');
        expect(mockEq).toHaveBeenCalledWith('account_id', 'account-456');
        expect(mockEq).toHaveBeenCalledWith('provider', 'runway');
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
      });
    });

    describe('Platform key detection', () => {
      it('should return true when platform key exists', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });
        process.env.RUNWAY_API_KEY = 'platform-key';

        const hasKey = await hasProviderApiKey('account-123', 'runway');

        expect(hasKey).toBe(true);
      });

      it('should check correct env var for each provider', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });

        const testCases = [
          { provider: 'kling', envVar: 'KLING_API_KEY' },
          { provider: 'runway', envVar: 'RUNWAY_API_KEY' },
          { provider: 'hailuo', envVar: 'HAILUO_API_KEY' },
          { provider: 'luma', envVar: 'LUMA_API_KEY' },
        ] as const;

        for (const { provider, envVar } of testCases) {
          // Clear all env vars
          delete process.env.KLING_API_KEY;
          delete process.env.RUNWAY_API_KEY;
          delete process.env.HAILUO_API_KEY;
          delete process.env.LUMA_API_KEY;

          // Set only the one we're testing
          process.env[envVar] = 'test-key';

          const hasKey = await hasProviderApiKey('account-123', provider);
          expect(hasKey).toBe(true);
        }
      });
    });

    describe('No key available', () => {
      it('should return false when no key exists', async () => {
        mockSingle.mockResolvedValue({ data: null, error: null });
        // No env vars set

        const hasKey = await hasProviderApiKey('account-123', 'luma');

        expect(hasKey).toBe(false);
      });

      it('should prioritize BYOK over platform key check', async () => {
        // BYOK key exists
        mockSingle.mockResolvedValue({
          data: { id: 'byok-key' },
          error: null,
        });
        // Platform key also exists
        process.env.KLING_API_KEY = 'platform-key';

        const hasKey = await hasProviderApiKey('account-123', 'kling');

        expect(hasKey).toBe(true);
        // Should return after finding BYOK, not check env
      });
    });
  });
});
