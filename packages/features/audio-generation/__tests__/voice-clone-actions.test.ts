import { beforeEach, describe, expect, it, vi } from 'vitest';

import { unwrap } from '@kit/next/action-result';

// Import actions after mocks are set up
import {
  checkCloneStatusAction,
  deleteVoiceCloneAction,
  startVoiceCloneAction,
} from '../src/server/voice-clone-actions';

// Mock server-only before any imports
vi.mock('server-only', () => ({}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  ),
}));

// Mock crypto
vi.mock('@kit/shared/crypto', () => ({
  decrypt: vi.fn((key: string) => `decrypted-${key}`),
}));

// Mock enhanceAction to pass through the function
vi.mock('@kit/next/actions', () => ({
  enhanceAction: vi.fn((fn, _options) => fn),
}));

// Mock requireUser
const mockRequireUser = vi.fn();
vi.mock('@kit/supabase/require-user', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
}));

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(),
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => mockSupabaseClient,
}));

// KB-84: the key is read through the access-checked helper. Each test still
// describes the stored row with its `external_api_keys` table mock; the helper
// mock returns that row, so "no key stored" stays a per-test decision.
vi.mock('@kit/supabase/external-api-keys', () => ({
  readExternalApiKey: vi.fn(async () => {
    const { data } = await mockSupabaseClient
      .from('external_api_keys')
      .select('encrypted_key')
      .eq('provider', 'elevenlabs')
      .single();

    return data ?? null;
  }),
}));

// Mock ElevenLabs provider
const mockCloneVoice = vi.fn();
const mockDeleteClonedVoice = vi.fn();

vi.mock('../src/providers/elevenlabs', () => ({
  ElevenLabsProvider: vi.fn().mockImplementation(() => ({
    cloneVoice: mockCloneVoice,
    deleteClonedVoice: mockDeleteClonedVoice,
  })),
}));

// KB-112: write access to the asset's project, asked as the caller. Its
// refusals are covered by voice-clone-authorization.test.ts; here the caller
// can write, and the target's account is the asset's.
const mockAuthorizeProjectTarget = vi.fn();
vi.mock('@kit/prompt-engine/llm-job-target', () => ({
  authorizeProjectTarget: (...args: unknown[]) =>
    mockAuthorizeProjectTarget(...args),
}));

// Mock fetch for audio sample downloads
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Voice Clone Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthorizeProjectTarget.mockImplementation(
      async (_client: unknown, projectId: string) => ({
        accountId: 'account-123',
        projectId,
      }),
    );

    // Default: user is authenticated
    mockRequireUser.mockResolvedValue({
      data: { id: 'user-123', email: 'test@example.com' },
      error: null,
    });
  });

  describe('startVoiceCloneAction', () => {
    const validInput = {
      assetId: '123e4567-e89b-12d3-a456-426614174000',
      voiceName: 'Test Voice',
      description: 'A test voice',
      samples: ['https://storage.example.com/sample1.mp3'],
      consent: {
        consenterName: 'John Doe',
        consentType: 'self' as const,
        consentText:
          'I hereby confirm that I am the owner of the voice used in the audio samples and agree to the terms.',
      },
    };

    describe('Authentication', () => {
      it('should throw error when user is not authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: { message: 'Not authenticated' },
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'Authentication required',
        );
      });

      it('should proceed when user is authenticated', async () => {
        // Setup mocks for successful flow
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'voice_profiles') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        // Mock platform key
        // API key mocked via external_api_keys table mock

        // Mock fetch for audio sample
        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });

        // Mock ElevenLabs response
        mockCloneVoice.mockResolvedValue({
          voiceId: 'voice-123',
          name: 'Test Voice',
          status: 'ready',
        });

        const result = await unwrap(startVoiceCloneAction(validInput));

        expect(result.success).toBe(true);
        expect(result.voiceId).toBe('voice-123');
        expect(result.status).toBe('ready');
      });
    });

    describe('Error Handling', () => {
      it('should throw error when asset is not found', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            };
          }
          return {};
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'Asset not found',
        );
      });

      // KB-6: a production build replaces a thrown message, so the refusal
      // comes back as a value and a crash is still thrown.
      it('returns a missing asset as a refusal, not a thrown error', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Not found' },
                  }),
                }),
              }),
            };
          }
          return {};
        });

        expect(await startVoiceCloneAction(validInput)).toEqual({
          ok: false,
          error: 'Asset not found',
        });
      });

      it('should refuse when the caller cannot write the asset’s project', async () => {
        mockAuthorizeProjectTarget.mockResolvedValue(null);

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: null },
                },
                error: null,
              }),
            };
          }
          return {};
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'Asset not found',
        );
      });

      it('should throw error when consent storage fails', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({
                error: { message: 'Failed to upsert' },
              }),
            };
          }
          return {};
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'Failed to store consent record',
        );
      });

      it('should throw error when no API key is configured', async () => {
        // No env key - tests require stored key mock

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'voice_profiles') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // This test is the one that wants no key on the account.
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'ElevenLabs API key not configured',
        );
      });

      it('should update status to failed when ElevenLabs API fails', async () => {
        // API key mocked via external_api_keys table mock

        const updateMock = vi.fn().mockReturnThis();
        const eqMock = vi.fn().mockResolvedValue({ error: null });

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'voice_profiles') {
            return {
              update: updateMock,
              eq: eqMock,
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });

        mockCloneVoice.mockRejectedValue(new Error('ElevenLabs API error'));

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'ElevenLabs API error',
        );

        // Verify status was updated to failed
        expect(updateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            clone_status: 'failed',
          }),
        );
      });

      it('should throw error when sample download fails', async () => {
        // API key mocked via external_api_keys table mock

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'voice_profiles') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
        });

        await expect(unwrap(startVoiceCloneAction(validInput))).rejects.toThrow(
          'Failed to download sample',
        );
      });
    });

    describe('Return Values', () => {
      it('should return success with voiceId and status on success', async () => {
        // API key mocked via external_api_keys table mock

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: validInput.assetId,
                  project_id: 'project-123',
                  projects: { account_id: 'account-123' },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'voice_profiles') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        });

        mockCloneVoice.mockResolvedValue({
          voiceId: 'voice-abc123',
          name: 'Test Voice',
          status: 'ready',
        });

        const result = await unwrap(startVoiceCloneAction(validInput));

        expect(result).toEqual({
          success: true,
          voiceId: 'voice-abc123',
          status: 'ready',
        });
      });
    });
  });

  describe('deleteVoiceCloneAction', () => {
    const validInput = {
      assetId: '123e4567-e89b-12d3-a456-426614174000',
    };

    describe('Authentication', () => {
      it('should throw error when user is not authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: { message: 'Not authenticated' },
        });

        await expect(
          unwrap(deleteVoiceCloneAction(validInput)),
        ).rejects.toThrow('Authentication required');
      });
    });

    describe('Error Handling', () => {
      it('should throw error when voice profile is not found', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            };
          }
          return {};
        });

        await expect(
          unwrap(deleteVoiceCloneAction(validInput)),
        ).rejects.toThrow('Voice profile not found');
      });

      it('should continue even when ElevenLabs deletion fails', async () => {
        // API key mocked via external_api_keys table mock

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              update: vi.fn().mockReturnThis(),
              // The clear reports the row it changed (KB-61)
              then: (resolve: (value: unknown) => unknown) =>
                resolve({ data: [{ asset_id: 'asset-123' }], error: null }),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  provider_voice_id: 'voice-123',
                  assets: {
                    project_id: 'project-123',
                    projects: { account_id: 'account-123' },
                  },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              delete: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        mockDeleteClonedVoice.mockRejectedValue(
          new Error('Voice already deleted'),
        );

        // Should not throw - deletion continues despite ElevenLabs error
        const result = await unwrap(deleteVoiceCloneAction(validInput));
        expect(result.success).toBe(true);
      });
    });

    describe('Return Values', () => {
      it('should return success when deletion completes', async () => {
        // API key mocked via external_api_keys table mock

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              update: vi.fn().mockReturnThis(),
              // The clear reports the row it changed (KB-61)
              then: (resolve: (value: unknown) => unknown) =>
                resolve({ data: [{ asset_id: 'asset-123' }], error: null }),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  provider_voice_id: 'voice-123',
                  assets: {
                    project_id: 'project-123',
                    projects: { account_id: 'account-123' },
                  },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              delete: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'external_api_keys') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              // Must return a row. getElevenLabsApiKey() used to fall back to
              // a platform-wide env key when the account had none; that
              // fallback was removed, so a null row now throws before the
              // action reaches the behaviour under test.
              single: vi.fn().mockResolvedValue({
                data: { encrypted_key: 'stored-key' },
                error: null,
              }),
            };
          }
          return {};
        });

        mockDeleteClonedVoice.mockResolvedValue(undefined);

        const result = await unwrap(deleteVoiceCloneAction(validInput));
        expect(result).toEqual({ success: true });
      });

      it('should skip ElevenLabs deletion when no provider_voice_id exists', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              update: vi.fn().mockReturnThis(),
              // The clear reports the row it changed (KB-61)
              then: (resolve: (value: unknown) => unknown) =>
                resolve({ data: [{ asset_id: 'asset-123' }], error: null }),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  provider_voice_id: null,
                  assets: {
                    project_id: 'project-123',
                    projects: { account_id: 'account-123' },
                  },
                },
                error: null,
              }),
            };
          }
          if (table === 'voice_consent') {
            return {
              delete: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return {};
        });

        const result = await unwrap(deleteVoiceCloneAction(validInput));

        expect(result.success).toBe(true);
        expect(mockDeleteClonedVoice).not.toHaveBeenCalled();
      });

      // KB-61: RLS answers an update it filters out with no rows and no
      // error, as it does one that worked
      it('refuses when clearing the clone changed no row', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              update: vi.fn().mockReturnThis(),
              then: (resolve: (value: unknown) => unknown) =>
                resolve({ data: [], error: null }),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  provider_voice_id: null,
                  assets: {
                    project_id: 'project-123',
                    projects: { account_id: 'account-123' },
                  },
                },
                error: null,
              }),
            };
          }
          return {};
        });

        await expect(deleteVoiceCloneAction(validInput)).resolves.toEqual({
          ok: false,
          error: "The voice clone wasn't removed.",
        });
      });
    });
  });

  describe('checkCloneStatusAction', () => {
    const validInput = {
      assetId: '123e4567-e89b-12d3-a456-426614174000',
    };

    describe('Authentication', () => {
      it('should throw error when user is not authenticated', async () => {
        mockRequireUser.mockResolvedValue({
          data: null,
          error: { message: 'Not authenticated' },
        });

        await expect(checkCloneStatusAction(validInput)).rejects.toThrow(
          'Authentication required',
        );
      });
    });

    describe('Error Handling', () => {
      it('should throw error when voice profile is not found', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            };
          }
          return {};
        });

        await expect(checkCloneStatusAction(validInput)).rejects.toThrow(
          'Voice profile not found',
        );
      });
    });

    describe('Return Values', () => {
      it('should return status, metadata, and voiceId', async () => {
        const mockMetadata = {
          training_started_at: '2025-12-11T00:00:00Z',
          training_completed_at: '2025-12-11T00:05:00Z',
        };

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  clone_status: 'ready',
                  clone_metadata: mockMetadata,
                  provider_voice_id: 'voice-xyz',
                },
                error: null,
              }),
            };
          }
          return {};
        });

        const result = await checkCloneStatusAction(validInput);

        expect(result).toEqual({
          status: 'ready',
          metadata: mockMetadata,
          voiceId: 'voice-xyz',
        });
      });

      it('should return null values when no clone exists', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  clone_status: null,
                  clone_metadata: {},
                  provider_voice_id: null,
                },
                error: null,
              }),
            };
          }
          return {};
        });

        const result = await checkCloneStatusAction(validInput);

        expect(result).toEqual({
          status: null,
          metadata: {},
          voiceId: null,
        });
      });

      it('should return training status during clone process', async () => {
        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  clone_status: 'training',
                  clone_metadata: {
                    training_started_at: '2025-12-11T00:00:00Z',
                  },
                  provider_voice_id: null,
                },
                error: null,
              }),
            };
          }
          return {};
        });

        const result = await checkCloneStatusAction(validInput);

        expect(result.status).toBe('training');
        expect(result.voiceId).toBeNull();
      });

      it('should return failed status with error metadata', async () => {
        const errorMetadata = {
          training_started_at: '2025-12-11T00:00:00Z',
          error: 'Insufficient audio quality',
        };

        mockSupabaseClient.from.mockImplementation((table: string) => {
          if (table === 'voice_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  clone_status: 'failed',
                  clone_metadata: errorMetadata,
                  provider_voice_id: null,
                },
                error: null,
              }),
            };
          }
          return {};
        });

        const result = await checkCloneStatusAction(validInput);

        expect(result.status).toBe('failed');
        expect(result.metadata).toEqual(errorMetadata);
      });
    });
  });
});
