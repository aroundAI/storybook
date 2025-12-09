/**
 * Character Server Actions Tests (FILM-202)
 * Tests for character CRUD operations
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { invalidatePromptCache } from '../src/lib/element-prompt/cache';
import {
  createCharacterAction,
  getCharacterAction,
  listCharactersAction,
  updateCharacterAction,
} from '../src/lib/server/character-actions';
import type {
  Character,
  ListCharactersResponse,
} from '../src/lib/types/character.types';

// Mock dependencies before imports
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  ),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: vi.fn((fn, _options) => async (data: unknown) => {
    return fn(data);
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../src/lib/element-prompt/cache', () => ({
  invalidatePromptCache: vi.fn(() => Promise.resolve()),
}));

describe('Character Server Actions', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };
  const mockCharacterId = '123e4567-e89b-12d3-a456-426614174000';
  const mockProjectId = '987fcdeb-51a2-34cd-b678-901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCharacterAction', () => {
    it('should throw if user is not authenticated', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        data: null,
        error: new Error('Not authenticated'),
      } as never);

      await expect(
        createCharacterAction({
          projectId: mockProjectId,
          name: 'Test Character',
        }),
      ).rejects.toThrow('Authentication required');
    });

    it('should create asset and character_details records', async () => {
      const mockAsset = {
        id: mockCharacterId,
        project_id: mockProjectId,
        type: 'character',
        name: 'Test Character',
        description: null,
        file_url: null,
        thumbnail_url: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
      };

      const mockDetails = {
        asset_id: mockCharacterId,
        voice_asset_id: null,
        physical_attributes: {},
        personality: null,
        element_prompt: null,
        reference_images: null,
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValueOnce({ data: mockAsset, error: null })
                .mockResolvedValueOnce({ data: mockDetails, error: null }),
            }),
          }),
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      const result = await createCharacterAction({
        projectId: mockProjectId,
        name: 'Test Character',
      });

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Test Character');
      expect(result.data.projectId).toBe(mockProjectId);
    });

    it('should rollback asset if character_details creation fails', async () => {
      const mockAsset = {
        id: mockCharacterId,
        project_id: mockProjectId,
        type: 'character',
        name: 'Test Character',
        description: null,
        file_url: null,
        thumbnail_url: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
      };

      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'assets') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: mockAsset, error: null }),
                }),
              }),
              delete: mockDelete,
            };
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Foreign key constraint violation' },
                }),
              }),
            }),
          };
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      await expect(
        createCharacterAction({
          projectId: mockProjectId,
          name: 'Test Character',
        }),
      ).rejects.toThrow('Failed to create character details');

      // Verify rollback was called
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('getCharacterAction', () => {
    it('should throw if user is not authenticated', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        data: null,
        error: new Error('Not authenticated'),
      } as never);

      await expect(
        getCharacterAction({ characterId: mockCharacterId }),
      ).rejects.toThrow('Authentication required');
    });

    it('should fetch character with details via JOIN', async () => {
      const mockResult = {
        id: mockCharacterId,
        project_id: mockProjectId,
        type: 'character',
        name: 'Test Character',
        description: 'A test description',
        file_url: 'https://example.com/image.png',
        thumbnail_url: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
        character_details: {
          voice_asset_id: null,
          physical_attributes: { age: 30, gender: 'male' },
          personality: JSON.stringify({ traits: ['brave'] }),
          element_prompt: 'A 30-year-old man...',
          reference_images: ['https://example.com/ref.png'],
        },
      };

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: mockResult, error: null }),
                }),
              }),
            }),
          }),
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      const result = await getCharacterAction({ characterId: mockCharacterId });

      expect(result.success).toBe(true);
      expect(result.data.id).toBe(mockCharacterId);
      expect(result.data.name).toBe('Test Character');
      expect(result.data.physicalAttributes?.age).toBe(30);
    });

    it('should throw if character not found', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Not found' },
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      await expect(
        getCharacterAction({ characterId: mockCharacterId }),
      ).rejects.toThrow('Failed to fetch character');
    });
  });

  describe('updateCharacterAction', () => {
    it('should throw if user is not authenticated', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        data: null,
        error: new Error('Not authenticated'),
      } as never);

      await expect(
        updateCharacterAction({
          characterId: mockCharacterId,
          name: 'Updated Name',
        }),
      ).rejects.toThrow('Authentication required');
    });

    it('should invalidate cache after successful update', async () => {
      const mockAsset = {
        id: mockCharacterId,
        project_id: mockProjectId,
        type: 'character',
        name: 'Updated Name',
        description: null,
        file_url: null,
        thumbnail_url: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
        deleted_at: null,
      };

      const mockDetails = {
        asset_id: mockCharacterId,
        voice_asset_id: null,
        physical_attributes: {},
        personality: null,
        element_prompt: null,
        reference_images: null,
      };

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'character_details') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: mockDetails, error: null }),
                }),
              }),
            };
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({ data: mockAsset, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      await updateCharacterAction({
        characterId: mockCharacterId,
        name: 'Updated Name',
      });

      // Verify cache invalidation was called
      expect(invalidatePromptCache).toHaveBeenCalledWith(mockCharacterId);
    });

    it('should fetch existing data upfront to minimize race condition', async () => {
      const mockDetails = {
        asset_id: mockCharacterId,
        voice_asset_id: null,
        physical_attributes: { age: 30 },
        personality: null,
        element_prompt: null,
        reference_images: null,
      };

      const mockAsset = {
        id: mockCharacterId,
        project_id: mockProjectId,
        type: 'character',
        name: 'Test',
        description: null,
        file_url: null,
        thumbnail_url: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
        deleted_at: null,
      };

      const selectMock = vi.fn();

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'character_details') {
            return {
              select: selectMock.mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: mockDetails, error: null }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi
                      .fn()
                      .mockResolvedValue({ data: mockDetails, error: null }),
                  }),
                }),
              }),
            };
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    select: vi.fn().mockReturnValue({
                      single: vi
                        .fn()
                        .mockResolvedValue({ data: mockAsset, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      await updateCharacterAction({
        characterId: mockCharacterId,
        physicalAttributes: { gender: 'female' },
      });

      // Verify that character_details was fetched first (for existing data)
      expect(selectMock).toHaveBeenCalled();
    });
  });

  describe('listCharactersAction', () => {
    it('should throw if user is not authenticated', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        data: null,
        error: new Error('Not authenticated'),
      } as never);

      await expect(
        listCharactersAction({ projectId: mockProjectId }),
      ).rejects.toThrow('Authentication required');
    });

    it('should return paginated list of characters', async () => {
      const mockResults = [
        {
          id: mockCharacterId,
          project_id: mockProjectId,
          type: 'character',
          name: 'Character 1',
          description: null,
          file_url: null,
          thumbnail_url: null,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
          deleted_at: null,
          character_details: {
            voice_asset_id: null,
            physical_attributes: {},
            personality: null,
            element_prompt: null,
            reference_images: null,
          },
        },
      ];

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({
                      data: mockResults,
                      error: null,
                      count: 1,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      const result = await listCharactersAction({ projectId: mockProjectId });

      expect(result.characters).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more results exist', async () => {
      const mockResults = Array(50)
        .fill(null)
        .map((_, i) => ({
          id: `character-${i}`,
          project_id: mockProjectId,
          type: 'character',
          name: `Character ${i}`,
          description: null,
          file_url: null,
          thumbnail_url: null,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
          deleted_at: null,
          character_details: null,
        }));

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({
                      data: mockResults,
                      error: null,
                      count: 100, // More results exist
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockClient as never);
      vi.mocked(requireUser).mockResolvedValue({
        data: mockUser,
        error: null,
      } as never);

      const result = await listCharactersAction({
        projectId: mockProjectId,
        limit: 50,
        offset: 0,
      });

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(100);
    });
  });
});

describe('Character Types', () => {
  describe('Character interface', () => {
    it('should accept valid character data', () => {
      const character: Character = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        projectId: '987fcdeb-51a2-34cd-b678-901234567890',
        name: 'Test Character',
        type: 'character',
        description: 'A test character',
        fileUrl: 'https://example.com/image.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: null,
        voiceAssetId: null,
        physicalAttributes: {
          age: 30,
          gender: 'male',
          build: 'athletic',
        },
        personality: {
          traits: ['brave', 'intelligent'],
        },
        clothing: {
          defaultOutfit: 'Casual jeans and t-shirt',
          style: 'casual',
        },
        backstory: 'A mysterious past...',
        elementPrompt: 'A 30-year-old athletic man...',
        referenceImages: ['https://example.com/ref1.png'],
      };

      expect(character.id).toBeDefined();
      expect(character.type).toBe('character');
    });

    it('should accept minimal character data', () => {
      const character: Character = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        projectId: '987fcdeb-51a2-34cd-b678-901234567890',
        name: 'Minimal Character',
        type: 'character',
        description: null,
        fileUrl: null,
        thumbnailUrl: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: null,
        voiceAssetId: null,
        physicalAttributes: null,
        personality: null,
        clothing: null,
        backstory: null,
        elementPrompt: null,
        referenceImages: null,
      };

      expect(character.physicalAttributes).toBeNull();
      expect(character.personality).toBeNull();
    });
  });

  describe('ListCharactersResponse interface', () => {
    it('should have correct structure', () => {
      const response: ListCharactersResponse = {
        characters: [],
        total: 0,
        hasMore: false,
      };

      expect(response.characters).toEqual([]);
      expect(response.total).toBe(0);
      expect(response.hasMore).toBe(false);
    });
  });
});
