import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import {
  IMAGE_DIMENSION_CONSTRAINTS,
  THUMBNAIL_SIZE,
  generateThumbnail,
  getImageDimensions,
  getThumbnailContentType,
  validateImageDimensions,
} from '../image-processor';

// Mock sharp for testing without actual image files
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn(),
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(),
  }));
  return { default: mockSharp };
});

describe('image-processor', () => {
  describe('constants', () => {
    it('should have correct dimension constraints', () => {
      expect(IMAGE_DIMENSION_CONSTRAINTS.minWidth).toBe(512);
      expect(IMAGE_DIMENSION_CONSTRAINTS.minHeight).toBe(512);
      expect(IMAGE_DIMENSION_CONSTRAINTS.maxWidth).toBe(4096);
      expect(IMAGE_DIMENSION_CONSTRAINTS.maxHeight).toBe(4096);
    });

    it('should have correct thumbnail size', () => {
      expect(THUMBNAIL_SIZE).toBe(256);
    });
  });

  describe('getThumbnailContentType', () => {
    it('should return webp content type', () => {
      expect(getThumbnailContentType()).toBe('image/webp');
    });
  });

  describe('getImageDimensions', () => {
    it('should return dimensions for valid image', async () => {
      const mockBuffer = Buffer.from('test');
      const mockMetadata = { width: 1024, height: 768 };

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue(mockMetadata),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await getImageDimensions(mockBuffer);

      expect(result).toEqual({ width: 1024, height: 768 });
    });

    it('should return null when metadata is missing dimensions', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({}),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await getImageDimensions(mockBuffer);

      expect(result).toBeNull();
    });

    it('should return null when sharp throws error', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockRejectedValue(new Error('Invalid image')),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await getImageDimensions(mockBuffer);

      expect(result).toBeNull();
    });
  });

  describe('validateImageDimensions', () => {
    it('should return valid for dimensions within constraints', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(mockBuffer);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error for dimensions below minimum', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 256, height: 256 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(mockBuffer);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('DIMENSIONS_TOO_SMALL');
      expect(result.error?.details.width).toBe(256);
      expect(result.error?.details.height).toBe(256);
    });

    it('should return error for dimensions above maximum', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 8192, height: 8192 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(mockBuffer);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('DIMENSIONS_TOO_LARGE');
      expect(result.error?.details.width).toBe(8192);
      expect(result.error?.details.height).toBe(8192);
    });

    it('should return error when dimensions cannot be read', async () => {
      const mockBuffer = Buffer.from('test');

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({}),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(mockBuffer);

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('DIMENSIONS_TOO_SMALL');
      expect(result.error?.message).toContain('corrupted');
    });

    it('should accept custom constraints', async () => {
      const mockBuffer = Buffer.from('test');
      const customConstraints = {
        minWidth: 100,
        minHeight: 100,
        maxWidth: 500,
        maxHeight: 500,
      };

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 300, height: 300 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(
        mockBuffer,
        customConstraints,
      );

      expect(result.valid).toBe(true);
    });

    it('should fail custom constraints when exceeded', async () => {
      const mockBuffer = Buffer.from('test');
      const customConstraints = {
        minWidth: 100,
        minHeight: 100,
        maxWidth: 500,
        maxHeight: 500,
      };

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 600, height: 400 }),
        resize: vi.fn().mockReturnThis(),
        webp: vi.fn().mockReturnThis(),
        toBuffer: vi.fn(),
      } as unknown as ReturnType<typeof sharp>);

      const result = await validateImageDimensions(
        mockBuffer,
        customConstraints,
      );

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('DIMENSIONS_TOO_LARGE');
    });
  });

  describe('generateThumbnail', () => {
    it('should generate thumbnail with default size', async () => {
      const mockBuffer = Buffer.from('test');
      const mockThumbnailBuffer = Buffer.from('thumbnail');
      const mockResize = vi.fn().mockReturnThis();
      const mockWebp = vi.fn().mockReturnThis();
      const mockToBuffer = vi.fn().mockResolvedValue(mockThumbnailBuffer);

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn(),
        resize: mockResize,
        webp: mockWebp,
        toBuffer: mockToBuffer,
      } as unknown as ReturnType<typeof sharp>);

      const result = await generateThumbnail(mockBuffer);

      expect(result).toBe(mockThumbnailBuffer);
      expect(mockResize).toHaveBeenCalledWith(256, 256, {
        fit: 'cover',
        position: 'centre',
      });
      expect(mockWebp).toHaveBeenCalledWith({ quality: 80 });
    });

    it('should generate thumbnail with custom size', async () => {
      const mockBuffer = Buffer.from('test');
      const mockThumbnailBuffer = Buffer.from('thumbnail');
      const mockResize = vi.fn().mockReturnThis();
      const mockWebp = vi.fn().mockReturnThis();
      const mockToBuffer = vi.fn().mockResolvedValue(mockThumbnailBuffer);

      vi.mocked(sharp).mockReturnValue({
        metadata: vi.fn(),
        resize: mockResize,
        webp: mockWebp,
        toBuffer: mockToBuffer,
      } as unknown as ReturnType<typeof sharp>);

      const result = await generateThumbnail(mockBuffer, 128);

      expect(result).toBe(mockThumbnailBuffer);
      expect(mockResize).toHaveBeenCalledWith(128, 128, {
        fit: 'cover',
        position: 'centre',
      });
    });
  });
});
