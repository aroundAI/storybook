import { describe, expect, it, vi } from 'vitest';

import {
  UPLOAD_CONSTRAINTS,
  UploadMetadataSchema,
  UploadResponseSchema,
  formatFileSize,
  generateStoragePath,
  getMaxFileSizeForCategory,
  sanitizeFilename,
  validateUpload,
} from '../src/lib/upload-validation';

/**
 * Creates a mock File object for testing
 */
function createMockFile(
  content: Uint8Array | string,
  name: string,
  type: string,
  size?: number,
): File {
  const blob = new Blob([content], { type });

  // Create a File-like object with custom size if specified
  const file = new File([blob], name, { type });

  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }

  return file;
}

/**
 * Creates a mock file with specific magic bytes
 */
function createFileWithMagicBytes(
  magicBytes: number[],
  name: string,
  type: string,
  size?: number,
): File {
  const content = new Uint8Array([...magicBytes, ...Array(100).fill(0)]);
  return createMockFile(content, name, type, size);
}

describe('Upload Validation', () => {
  describe('UPLOAD_CONSTRAINTS', () => {
    it('should have correct image constraints', () => {
      expect(UPLOAD_CONSTRAINTS.image.maxSize).toBe(10 * 1024 * 1024); // 10MB
      expect(UPLOAD_CONSTRAINTS.image.allowedTypes).toContain('image/jpeg');
      expect(UPLOAD_CONSTRAINTS.image.allowedTypes).toContain('image/png');
      expect(UPLOAD_CONSTRAINTS.image.allowedTypes).toContain('image/webp');
      expect(UPLOAD_CONSTRAINTS.image.allowedTypes).toContain('image/gif');
    });

    it('should have correct video constraints', () => {
      expect(UPLOAD_CONSTRAINTS.video.maxSize).toBe(500 * 1024 * 1024); // 500MB
      expect(UPLOAD_CONSTRAINTS.video.allowedTypes).toContain('video/mp4');
      expect(UPLOAD_CONSTRAINTS.video.allowedTypes).toContain('video/webm');
      expect(UPLOAD_CONSTRAINTS.video.allowedTypes).toContain(
        'video/quicktime',
      );
    });

    it('should have correct audio constraints', () => {
      expect(UPLOAD_CONSTRAINTS.audio.maxSize).toBe(50 * 1024 * 1024); // 50MB
      expect(UPLOAD_CONSTRAINTS.audio.allowedTypes).toContain('audio/mpeg');
      expect(UPLOAD_CONSTRAINTS.audio.allowedTypes).toContain('audio/wav');
      expect(UPLOAD_CONSTRAINTS.audio.allowedTypes).toContain('audio/ogg');
    });
  });

  describe('validateUpload', () => {
    describe('file size validation', () => {
      it('should pass for image at exactly max size', async () => {
        const magicBytes = [0xff, 0xd8, 0xff]; // JPEG
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.jpg',
          'image/jpeg',
          10 * 1024 * 1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(true);
      });

      it('should fail for image 1 byte over max size', async () => {
        const magicBytes = [0xff, 0xd8, 0xff]; // JPEG
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.jpg',
          'image/jpeg',
          10 * 1024 * 1024 + 1,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('FILE_TOO_LARGE');
        expect(result.error?.details?.maxSize).toBe(10 * 1024 * 1024);
      });

      it('should pass for video at exactly max size', async () => {
        const magicBytes = [0x1a, 0x45, 0xdf, 0xa3]; // WebM
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.webm',
          'video/webm',
          500 * 1024 * 1024,
        );

        const result = await validateUpload(file, 'video');
        expect(result.valid).toBe(true);
      });

      it('should fail for video over max size', async () => {
        const magicBytes = [0x1a, 0x45, 0xdf, 0xa3]; // WebM
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.webm',
          'video/webm',
          500 * 1024 * 1024 + 1,
        );

        const result = await validateUpload(file, 'video');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('FILE_TOO_LARGE');
      });

      it('should pass for audio at exactly max size', async () => {
        const magicBytes = [0x52, 0x49, 0x46, 0x46]; // WAV
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.wav',
          'audio/wav',
          50 * 1024 * 1024,
        );

        const result = await validateUpload(file, 'audio');
        expect(result.valid).toBe(true);
      });

      it('should fail for audio over max size', async () => {
        const magicBytes = [0x52, 0x49, 0x46, 0x46]; // WAV
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.wav',
          'audio/wav',
          50 * 1024 * 1024 + 1,
        );

        const result = await validateUpload(file, 'audio');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('FILE_TOO_LARGE');
      });
    });

    describe('MIME type validation', () => {
      it('should pass valid MIME types for images', async () => {
        const validTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ];
        const magicBytesMap: Record<string, number[]> = {
          'image/jpeg': [0xff, 0xd8, 0xff],
          'image/png': [0x89, 0x50, 0x4e, 0x47],
          'image/webp': [0x52, 0x49, 0x46, 0x46],
          'image/gif': [0x47, 0x49, 0x46, 0x38],
        };
        const extensions: Record<string, string> = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
          'image/gif': 'gif',
        };

        for (const type of validTypes) {
          const file = createFileWithMagicBytes(
            magicBytesMap[type]!,
            `test.${extensions[type]}`,
            type,
            1024,
          );
          const result = await validateUpload(file, 'image');
          expect(result.valid).toBe(true);
        }
      });

      it('should fail invalid MIME types for images', async () => {
        const file = createMockFile('test', 'test.txt', 'text/plain', 1024);
        const result = await validateUpload(file, 'image');

        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_TYPE');
        expect(result.error?.details?.actualType).toBe('text/plain');
      });

      it('should pass valid MIME types for video', async () => {
        const magicBytes = [0x1a, 0x45, 0xdf, 0xa3]; // WebM
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.webm',
          'video/webm',
          1024,
        );
        const result = await validateUpload(file, 'video');
        expect(result.valid).toBe(true);
      });

      it('should fail invalid MIME types for video', async () => {
        const file = createMockFile('test', 'test.txt', 'text/plain', 1024);
        const result = await validateUpload(file, 'video');

        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_TYPE');
      });
    });

    describe('extension validation', () => {
      it('should fail when extension does not match', async () => {
        // File with JPEG content but .txt extension
        const magicBytes = [0xff, 0xd8, 0xff];
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.txt',
          'image/jpeg',
          1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_EXTENSION');
      });

      it('should handle uppercase extensions', async () => {
        const magicBytes = [0xff, 0xd8, 0xff];
        const file = createFileWithMagicBytes(
          magicBytes,
          'test.JPG',
          'image/jpeg',
          1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(true);
      });
    });

    describe('magic bytes validation', () => {
      it('should detect JPEG magic bytes', async () => {
        const validBytes = [0xff, 0xd8, 0xff];
        const file = createFileWithMagicBytes(
          validBytes,
          'test.jpg',
          'image/jpeg',
          1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(true);
      });

      it('should detect PNG magic bytes', async () => {
        const validBytes = [0x89, 0x50, 0x4e, 0x47];
        const file = createFileWithMagicBytes(
          validBytes,
          'test.png',
          'image/png',
          1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(true);
      });

      it('should detect WebM magic bytes', async () => {
        const validBytes = [0x1a, 0x45, 0xdf, 0xa3];
        const file = createFileWithMagicBytes(
          validBytes,
          'test.webm',
          'video/webm',
          1024,
        );

        const result = await validateUpload(file, 'video');
        expect(result.valid).toBe(true);
      });

      it('should reject file with wrong magic bytes', async () => {
        // PNG magic bytes but claiming to be JPEG
        const pngBytes = [0x89, 0x50, 0x4e, 0x47];
        const file = createFileWithMagicBytes(
          pngBytes,
          'test.jpg',
          'image/jpeg',
          1024,
        );

        const result = await validateUpload(file, 'image');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('CORRUPTED_FILE');
      });

      it('should pass for audio/mp4 without magic bytes check', async () => {
        // audio/mp4 doesn't have defined magic bytes in our constraints
        const file = createMockFile(
          new Uint8Array([0x00, 0x00, 0x00, 0x20]),
          'test.m4a',
          'audio/mp4',
          1024,
        );

        const result = await validateUpload(file, 'audio');
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove path traversal attempts', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('system32');
      expect(sanitizeFilename('/root/secret.txt')).toBe('secret.txt');
    });

    it('should replace unsafe characters', () => {
      expect(sanitizeFilename('hello world.jpg')).toBe('hello_world.jpg');
      expect(sanitizeFilename('file<script>.png')).toBe('file_script_.png');
      expect(sanitizeFilename("test'quote.gif")).toBe('test_quote.gif');
    });

    it('should collapse multiple underscores', () => {
      expect(sanitizeFilename('hello___world.jpg')).toBe('hello_world.jpg');
      expect(sanitizeFilename('a   b   c.png')).toBe('a_b_c.png');
    });

    it('should convert to lowercase', () => {
      expect(sanitizeFilename('MyFile.JPG')).toBe('myfile.jpg');
      expect(sanitizeFilename('TEST.PNG')).toBe('test.png');
    });

    it('should preserve extension', () => {
      expect(sanitizeFilename('file.tar.gz')).toBe('file_tar.gz');
      expect(sanitizeFilename('name.min.js')).toBe('name_min.js');
    });

    it('should handle files without extension', () => {
      expect(sanitizeFilename('filename')).toBe('filename');
      expect(sanitizeFilename('FILE NAME')).toBe('file_name');
    });

    it('should handle empty string', () => {
      expect(sanitizeFilename('')).toBe('file');
    });
  });

  describe('generateStoragePath', () => {
    it('should generate unique paths', () => {
      const projectId = '123e4567-e89b-12d3-a456-426614174000';
      const assetId = '987fcdeb-51a2-34cd-b678-901234567890';

      const path1 = generateStoragePath(
        projectId,
        assetId,
        'thumbnail',
        'image.jpg',
      );
      const path2 = generateStoragePath(
        projectId,
        assetId,
        'thumbnail',
        'image.jpg',
      );

      // Paths should be different due to timestamp and random component
      expect(path1).not.toBe(path2);
    });

    it('should include project and asset IDs', () => {
      const projectId = '123e4567-e89b-12d3-a456-426614174000';
      const assetId = '987fcdeb-51a2-34cd-b678-901234567890';

      const path = generateStoragePath(projectId, assetId, 'file', 'video.mp4');

      expect(path).toContain(projectId);
      expect(path).toContain(assetId);
    });

    it('should include field type', () => {
      const projectId = '123e4567-e89b-12d3-a456-426614174000';
      const assetId = '987fcdeb-51a2-34cd-b678-901234567890';

      const thumbnailPath = generateStoragePath(
        projectId,
        assetId,
        'thumbnail',
        'img.jpg',
      );
      const filePath = generateStoragePath(
        projectId,
        assetId,
        'file',
        'video.mp4',
      );
      const referencePath = generateStoragePath(
        projectId,
        assetId,
        'reference',
        'ref.png',
      );

      expect(thumbnailPath).toContain('thumbnail-');
      expect(filePath).toContain('file-');
      expect(referencePath).toContain('reference-');
    });

    it('should sanitize the filename', () => {
      const projectId = '123e4567-e89b-12d3-a456-426614174000';
      const assetId = '987fcdeb-51a2-34cd-b678-901234567890';

      const path = generateStoragePath(
        projectId,
        assetId,
        'file',
        '../../../UNSAFE File.mp4',
      );

      expect(path).toContain('unsafe_file.mp4');
      expect(path).not.toContain('..');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(500)).toBe('500 Bytes');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should handle decimal values', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });

  describe('getMaxFileSizeForCategory', () => {
    it('should return correct max sizes', () => {
      expect(getMaxFileSizeForCategory('image')).toBe('10 MB');
      expect(getMaxFileSizeForCategory('video')).toBe('500 MB');
      expect(getMaxFileSizeForCategory('audio')).toBe('50 MB');
    });
  });

  describe('Zod schemas', () => {
    describe('UploadMetadataSchema', () => {
      it('should validate correct metadata', () => {
        const validData = {
          assetId: '123e4567-e89b-12d3-a456-426614174000',
          projectId: '987fcdeb-51a2-34cd-b678-901234567890',
          fieldType: 'thumbnail',
          category: 'image',
        };

        const result = UploadMetadataSchema.safeParse(validData);
        expect(result.success).toBe(true);
      });

      it('should reject invalid UUIDs', () => {
        const invalidData = {
          assetId: 'not-a-uuid',
          projectId: '987fcdeb-51a2-34cd-b678-901234567890',
          fieldType: 'thumbnail',
          category: 'image',
        };

        const result = UploadMetadataSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });

      it('should reject invalid field types', () => {
        const invalidData = {
          assetId: '123e4567-e89b-12d3-a456-426614174000',
          projectId: '987fcdeb-51a2-34cd-b678-901234567890',
          fieldType: 'invalid',
          category: 'image',
        };

        const result = UploadMetadataSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });

      it('should reject invalid categories', () => {
        const invalidData = {
          assetId: '123e4567-e89b-12d3-a456-426614174000',
          projectId: '987fcdeb-51a2-34cd-b678-901234567890',
          fieldType: 'file',
          category: 'document',
        };

        const result = UploadMetadataSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });
    });

    describe('UploadResponseSchema', () => {
      it('should validate correct response', () => {
        const validResponse = {
          url: 'https://storage.example.com/file.jpg',
          path: 'project/asset/file.jpg',
          size: 1024,
          contentType: 'image/jpeg',
        };

        const result = UploadResponseSchema.safeParse(validResponse);
        expect(result.success).toBe(true);
      });

      it('should reject invalid URL', () => {
        const invalidResponse = {
          url: 'not-a-url',
          path: 'project/asset/file.jpg',
          size: 1024,
          contentType: 'image/jpeg',
        };

        const result = UploadResponseSchema.safeParse(invalidResponse);
        expect(result.success).toBe(false);
      });
    });
  });
});
