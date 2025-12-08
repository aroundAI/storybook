import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetTypeSchema,
  CreateAssetSchema,
  DeleteAssetSchema,
  GetProjectAssetsSchema,
  UpdateAssetSchema,
} from '../src/lib/schemas/asset.schema';
import type {
  Asset,
  AssetRow,
  GetProjectAssetsResponse,
} from '../src/lib/types';
import { mapRowToAsset } from '../src/lib/types';

// Mock dependencies
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

describe('Asset Schemas', () => {
  describe('AssetTypeSchema', () => {
    it('should accept valid asset types', () => {
      const validTypes = [
        'character',
        'location',
        'prop',
        'voice',
        'music',
        'sfx',
      ];

      for (const type of validTypes) {
        const result = AssetTypeSchema.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid asset types', () => {
      const result = AssetTypeSchema.safeParse('invalid');
      expect(result.success).toBe(false);
    });
  });

  describe('CreateAssetSchema', () => {
    it('should validate valid create asset data', () => {
      const validData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        name: 'Test Character',
        description: 'A test character',
        fileUrl: 'https://example.com/image.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        metadata: { personality: 'friendly' },
      };

      const result = CreateAssetSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should accept minimal valid data', () => {
      const minimalData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'location',
        name: 'Test Location',
      };

      const result = CreateAssetSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid project ID', () => {
      const invalidData = {
        projectId: 'not-a-uuid',
        type: 'character',
        name: 'Test',
      };

      const result = CreateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        name: '',
      };

      const result = CreateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject name over 255 characters', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        name: 'a'.repeat(256),
      };

      const result = CreateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject description over 1000 characters', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        name: 'Test',
        description: 'a'.repeat(1001),
      };

      const result = CreateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid fileUrl', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        name: 'Test',
        fileUrl: 'not-a-url',
      };

      const result = CreateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateAssetSchema', () => {
    it('should validate valid update data with all fields', () => {
      const validData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Name',
        description: 'Updated description',
        fileUrl: 'https://example.com/new-image.png',
        thumbnailUrl: 'https://example.com/new-thumb.png',
        metadata: { updated: true },
      };

      const result = UpdateAssetSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should accept partial update with only id', () => {
      const partialData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = UpdateAssetSchema.safeParse(partialData);
      expect(result.success).toBe(true);
    });

    it('should accept update with only name', () => {
      const partialData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'New Name',
      };

      const result = UpdateAssetSchema.safeParse(partialData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid asset ID', () => {
      const invalidData = {
        id: 'not-a-uuid',
        name: 'Test',
      };

      const result = UpdateAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('GetProjectAssetsSchema', () => {
    it('should validate valid query with all options', () => {
      const validData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        type: 'character',
        limit: 20,
        offset: 10,
      };

      const result = GetProjectAssetsSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should accept minimal query with only projectId', () => {
      const minimalData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = GetProjectAssetsSchema.safeParse(minimalData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50); // default
        expect(result.data.offset).toBe(0); // default
      }
    });

    it('should reject limit over 100', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 101,
      };

      const result = GetProjectAssetsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject limit under 1', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 0,
      };

      const result = GetProjectAssetsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject negative offset', () => {
      const invalidData = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        offset: -1,
      };

      const result = GetProjectAssetsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('DeleteAssetSchema', () => {
    it('should validate valid asset ID', () => {
      const validData = {
        assetId: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = DeleteAssetSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid asset ID', () => {
      const invalidData = {
        assetId: 'not-a-uuid',
      };

      const result = DeleteAssetSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});

describe('Asset Types', () => {
  describe('mapRowToAsset', () => {
    it('should correctly map database row to Asset type', () => {
      const row: AssetRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_id: '987fcdeb-51a2-34cd-b678-901234567890',
        type: 'character',
        name: 'Test Character',
        description: 'A test character',
        file_url: 'https://example.com/image.png',
        thumbnail_url: 'https://example.com/thumb.png',
        metadata: { personality: 'friendly' },
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
      };

      const asset = mapRowToAsset(row);

      expect(asset).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        projectId: '987fcdeb-51a2-34cd-b678-901234567890',
        type: 'character',
        name: 'Test Character',
        description: 'A test character',
        fileUrl: 'https://example.com/image.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        metadata: { personality: 'friendly' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        deletedAt: null,
      });
    });

    it('should handle null values correctly', () => {
      const row: AssetRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_id: '987fcdeb-51a2-34cd-b678-901234567890',
        type: 'location',
        name: 'Test Location',
        description: null,
        file_url: null,
        thumbnail_url: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
      };

      const asset = mapRowToAsset(row);

      expect(asset.description).toBeNull();
      expect(asset.fileUrl).toBeNull();
      expect(asset.thumbnailUrl).toBeNull();
    });

    it('should handle deleted_at timestamp', () => {
      const row: AssetRow = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        project_id: '987fcdeb-51a2-34cd-b678-901234567890',
        type: 'prop',
        name: 'Deleted Prop',
        description: null,
        file_url: null,
        thumbnail_url: null,
        metadata: {},
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: '2024-01-02T00:00:00.000Z',
      };

      const asset = mapRowToAsset(row);

      expect(asset.deletedAt).toBe('2024-01-02T00:00:00.000Z');
    });
  });
});

describe('GetProjectAssetsResponse', () => {
  it('should have correct structure', () => {
    const response: GetProjectAssetsResponse = {
      assets: [],
      total: 0,
      hasMore: false,
    };

    expect(response).toHaveProperty('assets');
    expect(response).toHaveProperty('total');
    expect(response).toHaveProperty('hasMore');
    expect(Array.isArray(response.assets)).toBe(true);
  });

  it('should correctly indicate hasMore for pagination', () => {
    const responseWithMore: GetProjectAssetsResponse = {
      assets: [],
      total: 100,
      hasMore: true,
    };

    const responseWithoutMore: GetProjectAssetsResponse = {
      assets: [],
      total: 10,
      hasMore: false,
    };

    expect(responseWithMore.hasMore).toBe(true);
    expect(responseWithoutMore.hasMore).toBe(false);
  });
});
