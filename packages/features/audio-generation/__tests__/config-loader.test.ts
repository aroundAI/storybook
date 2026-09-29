import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import mocked functions
import { decrypt } from '@kit/shared/crypto';
import { readExternalApiKey } from '@kit/supabase/external-api-keys';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Import the module under test
import {
  hasVoiceProviderApiKey,
  loadVoiceProviderConfig,
} from '../src/providers/config-loader';
import { NoAPIKeyError } from '../src/providers/errors';

// Mock dependencies before importing the module under test
vi.mock('@kit/shared/crypto', () => ({
  decrypt: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/supabase/external-api-keys', () => ({
  readExternalApiKey: vi.fn(),
}));

const mockedDecrypt = vi.mocked(decrypt);
const mockedGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);
const mockedReadKey = vi.mocked(readExternalApiKey);

function storedKey(encryptedKey: string) {
  return { provider: 'any', encrypted_key: encryptedKey, is_active: true };
}

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
    // Clear platform keys (ElevenLabs NOT included - uses stored keys only)
    delete process.env.PLAYHT_API_KEY;
    delete process.env.PLAYHT_USER_ID;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.AZURE_TTS_API_KEY;
    delete process.env.GOOGLE_TTS_API_KEY;

    // Setup default mock chain
    mockedGetSupabaseServerClient.mockReturnValue(mockClient as never);
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadVoiceProviderConfig', () => {
    describe('BYOK key loading', () => {
      it('should load and decrypt BYOK key from database', async () => {
        // Mock database returns encrypted key
        mockedReadKey.mockResolvedValue(storedKey('encrypted-byok-key'));
        mockedDecrypt.mockResolvedValue('decrypted-api-key');

        const config = await loadVoiceProviderConfig(
          'account-123',
          'elevenlabs',
        );

        expect(config.apiKey).toBe('decrypted-api-key');
        expect(mockedDecrypt).toHaveBeenCalledWith('encrypted-byok-key');
        expect(mockedReadKey).toHaveBeenCalled();
      });

      it('should query with correct filters', async () => {
        mockedReadKey.mockResolvedValue(storedKey('encrypted-key'));
        mockedDecrypt.mockResolvedValue('api-key');

        await loadVoiceProviderConfig('account-456', 'playht');

        // Verify the query chain was called with correct parameters
        // KB-84: the access-checked helper, on the caller's client
        expect(mockedReadKey).toHaveBeenCalledWith(
          mockClient,
          'account-456',
          'playht',
        );
      });

      it('should fail, not fall back to the platform key, when a stored key cannot be decrypted', async () => {
        process.env.PLAYHT_API_KEY = 'platform-key';
        process.env.PLAYHT_USER_ID = 'platform-user';
        mockedReadKey.mockResolvedValue(storedKey('corrupt-ciphertext'));
        mockedDecrypt.mockRejectedValue(new Error('Unsupported state'));

        await expect(
          loadVoiceProviderConfig('account-123', 'playht'),
        ).rejects.toThrow('Unsupported state');
      });
    });

    describe('Platform key fallback (non-ElevenLabs only)', () => {
      it('should use platform key when no BYOK key exists for supported providers', async () => {
        // Mock database returns no key (PGRST116 error)
        mockedReadKey.mockResolvedValue(null);
        process.env.PLAYHT_API_KEY = 'platform-playht-key';

        const config = await loadVoiceProviderConfig('account-123', 'playht');

        expect(config.apiKey).toBe('platform-playht-key');
        expect(mockedDecrypt).not.toHaveBeenCalled();
      });

      it('should use correct env var for non-ElevenLabs providers', async () => {
        mockedReadKey.mockResolvedValue(null);

        // Test each provider's env var mapping (ElevenLabs excluded - uses stored keys only)
        const providers = [
          { name: 'playht', envVar: 'PLAYHT_API_KEY', key: 'playht-key' },
          { name: 'deepgram', envVar: 'DEEPGRAM_API_KEY', key: 'deepgram-key' },
          { name: 'azure', envVar: 'AZURE_TTS_API_KEY', key: 'azure-key' },
          { name: 'google', envVar: 'GOOGLE_TTS_API_KEY', key: 'google-key' },
        ] as const;

        for (const { name, envVar, key } of providers) {
          process.env[envVar] = key;
          const config = await loadVoiceProviderConfig('account-123', name);
          expect(config.apiKey).toBe(key);
          delete process.env[envVar];
        }
      });
    });

    describe('ElevenLabs requires stored keys', () => {
      it('should throw when no stored key for ElevenLabs', async () => {
        // Mock database returns no key
        mockedReadKey.mockResolvedValue(null);
        // Note: No env fallback for ElevenLabs

        await expect(
          loadVoiceProviderConfig('account-123', 'elevenlabs'),
        ).rejects.toThrow(NoAPIKeyError);
      });
    });

    describe('PlayHT userId', () => {
      it('should include userId for PlayHT provider', async () => {
        mockedReadKey.mockResolvedValue(null);
        process.env.PLAYHT_API_KEY = 'playht-key';
        process.env.PLAYHT_USER_ID = 'playht-user-123';

        const config = await loadVoiceProviderConfig('account-123', 'playht');

        expect(config.apiKey).toBe('playht-key');
        expect(config.userId).toBe('playht-user-123');
      });
    });

    describe('Error handling', () => {
      it('should throw NoAPIKeyError when no key is available', async () => {
        // No BYOK key in database
        mockedReadKey.mockResolvedValue(null);
        // No platform key in env for deepgram
        delete process.env.DEEPGRAM_API_KEY;

        await expect(
          loadVoiceProviderConfig('account-123', 'deepgram'),
        ).rejects.toThrow(NoAPIKeyError);
      });

      it('should include provider name in NoAPIKeyError', async () => {
        mockedReadKey.mockResolvedValue(null);

        try {
          await loadVoiceProviderConfig('account-123', 'playht');
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(NoAPIKeyError);
          expect((error as NoAPIKeyError).providerName).toBe('playht');
        }
      });

      it('should throw on database error (non-PGRST116)', async () => {
        mockedReadKey.mockRejectedValue(new Error('Internal server error'));

        await expect(
          loadVoiceProviderConfig('account-123', 'elevenlabs'),
        ).rejects.toThrow(
          'Failed to load voice provider config: Internal server error',
        );
      });
    });
  });

  describe('hasVoiceProviderApiKey', () => {
    describe('BYOK key detection', () => {
      it('should return true when BYOK key exists', async () => {
        mockSingle.mockResolvedValue({
          data: { id: 'key-123' },
          error: null,
        });

        const hasKey = await hasVoiceProviderApiKey(
          'account-123',
          'elevenlabs',
        );

        expect(hasKey).toBe(true);
        expect(mockSelect).toHaveBeenCalledWith('id');
      });

      it('should query with correct filters', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'no rows found' },
        });

        await hasVoiceProviderApiKey('account-456', 'playht');

        expect(mockFrom).toHaveBeenCalledWith('external_api_keys');
        expect(mockEq).toHaveBeenCalledWith('account_id', 'account-456');
        expect(mockEq).toHaveBeenCalledWith('provider', 'playht');
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
      });
    });

    describe('Platform key detection (non-ElevenLabs)', () => {
      it('should return true when platform key exists for supported providers', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'no rows found' },
        });
        process.env.PLAYHT_API_KEY = 'platform-key';

        const hasKey = await hasVoiceProviderApiKey('account-123', 'playht');

        expect(hasKey).toBe(true);
      });

      it('should check correct env var for non-ElevenLabs providers', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'no rows found' },
        });

        // ElevenLabs excluded - uses stored keys only
        const testCases = [
          { provider: 'playht', envVar: 'PLAYHT_API_KEY' },
          { provider: 'deepgram', envVar: 'DEEPGRAM_API_KEY' },
          { provider: 'azure', envVar: 'AZURE_TTS_API_KEY' },
          { provider: 'google', envVar: 'GOOGLE_TTS_API_KEY' },
        ] as const;

        for (const { provider, envVar } of testCases) {
          // Clear all env vars
          delete process.env.PLAYHT_API_KEY;
          delete process.env.DEEPGRAM_API_KEY;
          delete process.env.AZURE_TTS_API_KEY;
          delete process.env.GOOGLE_TTS_API_KEY;

          // Set only the one we're testing
          process.env[envVar] = 'test-key';

          const hasKey = await hasVoiceProviderApiKey('account-123', provider);
          expect(hasKey).toBe(true);
        }
      });
    });

    describe('ElevenLabs stored keys only', () => {
      it('should return false for ElevenLabs when no stored key exists', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'no rows found' },
        });
        // Note: No env fallback for ElevenLabs

        const hasKey = await hasVoiceProviderApiKey(
          'account-123',
          'elevenlabs',
        );
        expect(hasKey).toBe(false);
      });
    });

    describe('No key available', () => {
      it('should return false when no key exists', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'no rows found' },
        });

        const hasKey = await hasVoiceProviderApiKey('account-123', 'deepgram');

        expect(hasKey).toBe(false);
      });

      it('should throw on database error (non-PGRST116)', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST500', message: 'Internal server error' },
        });

        await expect(
          hasVoiceProviderApiKey('account-123', 'elevenlabs'),
        ).rejects.toThrow(
          'Failed to check voice provider API key: Internal server error',
        );
      });
    });
  });
});
