import { z } from 'zod';

/**
 * Upload constraints per file category
 */
export const UPLOAD_CONSTRAINTS = {
  image: {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ] as const,
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const,
    magicBytes: {
      'image/jpeg': [0xff, 0xd8, 0xff],
      'image/png': [0x89, 0x50, 0x4e, 0x47],
      'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF header
      'image/gif': [0x47, 0x49, 0x46, 0x38],
    } as Record<string, number[]>,
  },
  video: {
    maxSize: 500 * 1024 * 1024, // 500MB
    allowedTypes: ['video/mp4', 'video/webm', 'video/quicktime'] as const,
    allowedExtensions: ['.mp4', '.webm', '.mov'] as const,
    magicBytes: {
      'video/mp4': [0x00, 0x00, 0x00], // ftyp box (variable)
      'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
      'video/quicktime': [0x00, 0x00, 0x00], // moov/ftyp
    } as Record<string, number[]>,
  },
  audio: {
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
    ] as const,
    allowedExtensions: ['.mp3', '.wav', '.ogg', '.m4a'] as const,
    magicBytes: {
      'audio/mpeg': [0xff, 0xfb], // or ID3 tag
      'audio/wav': [0x52, 0x49, 0x46, 0x46],
      'audio/ogg': [0x4f, 0x67, 0x67, 0x53],
    } as Record<string, number[]>,
  },
} as const;

export type UploadCategory = keyof typeof UPLOAD_CONSTRAINTS;

/**
 * Validation error codes
 */
export type ValidationErrorCode =
  | 'FILE_TOO_LARGE'
  | 'INVALID_TYPE'
  | 'INVALID_EXTENSION'
  | 'CORRUPTED_FILE'
  | 'UNKNOWN_ERROR';

/**
 * Validation result returned by validateUpload
 */
export interface ValidationResult {
  valid: boolean;
  error?: {
    code: ValidationErrorCode;
    message: string;
    details?: {
      maxSize?: number;
      actualSize?: number;
      expectedTypes?: readonly string[];
      actualType?: string;
    };
  };
}

/**
 * A validated file with sanitized metadata
 */
export interface ValidatedFile {
  file: File;
  category: UploadCategory;
  sanitizedName: string;
  contentType: string;
}

/**
 * Validates a file against upload constraints for the given category.
 *
 * Performs the following checks:
 * 1. File size within limits
 * 2. MIME type is allowed
 * 3. File extension matches expected types
 * 4. Magic bytes match declared content type
 */
export async function validateUpload(
  file: File,
  category: UploadCategory,
): Promise<ValidationResult> {
  const constraints = UPLOAD_CONSTRAINTS[category];

  // 1. Check file size
  if (file.size > constraints.maxSize) {
    const maxMB = Math.round(constraints.maxSize / (1024 * 1024));
    const actualMB = Math.round((file.size / (1024 * 1024)) * 100) / 100;
    return {
      valid: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File is ${actualMB}MB but maximum allowed is ${maxMB}MB`,
        details: {
          maxSize: constraints.maxSize,
          actualSize: file.size,
        },
      },
    };
  }

  // 2. Check MIME type
  const allowedTypes = constraints.allowedTypes as readonly string[];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_TYPE',
        message: `File type "${file.type}" is not allowed. Accepted types: ${constraints.allowedTypes.join(', ')}`,
        details: {
          expectedTypes: constraints.allowedTypes,
          actualType: file.type,
        },
      },
    };
  }

  // 3. Check file extension
  const ext = '.' + (file.name.toLowerCase().split('.').pop() ?? '');
  const allowedExtensions = constraints.allowedExtensions as readonly string[];
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_EXTENSION',
        message: `File extension "${ext}" is not allowed. Accepted extensions: ${constraints.allowedExtensions.join(', ')}`,
      },
    };
  }

  // 4. Verify magic bytes (content validation)
  const isValidContent = await verifyMagicBytes(file, category);
  if (!isValidContent) {
    return {
      valid: false,
      error: {
        code: 'CORRUPTED_FILE',
        message:
          'File content does not match its declared type. The file may be corrupted or mislabeled.',
      },
    };
  }

  return { valid: true };
}

/**
 * Verifies file content matches expected magic bytes for the declared type.
 */
async function verifyMagicBytes(
  file: File,
  category: UploadCategory,
): Promise<boolean> {
  const constraints = UPLOAD_CONSTRAINTS[category];
  const magicBytes = constraints.magicBytes[file.type];

  if (!magicBytes) {
    // No magic bytes defined for this type, skip content validation
    return true;
  }

  try {
    const buffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);

    // Check if file starts with expected magic bytes
    for (let i = 0; i < magicBytes.length; i++) {
      if (bytes[i] !== magicBytes[i]) {
        return false;
      }
    }

    return true;
  } catch {
    // If we can't read the file, fail validation
    return false;
  }
}

/**
 * Sanitizes a filename for safe storage.
 *
 * - Removes path traversal attempts
 * - Replaces unsafe characters with underscores
 * - Converts to lowercase
 * - Preserves the file extension
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  const basename = filename.split(/[\\/]/).pop() || 'file';

  // Replace unsafe characters
  const sanitized = basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();

  // Ensure extension is preserved
  const parts = sanitized.split('.');
  if (parts.length > 1) {
    const ext = parts.pop();
    const name = parts.join('_');
    return `${name}.${ext}`;
  }

  // Return 'file' if sanitized result is empty
  return sanitized || 'file';
}

/**
 * Generates a unique storage path for an uploaded file.
 *
 * Format: {projectId}/{assetId}/{fieldType}-{timestamp}-{random}-{sanitizedFilename}
 */
export function generateStoragePath(
  projectId: string,
  assetId: string,
  fieldType: 'thumbnail' | 'file' | 'reference',
  filename: string,
): string {
  const sanitized = sanitizeFilename(filename);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  return `${projectId}/${assetId}/${fieldType}-${timestamp}-${random}-${sanitized}`;
}

/**
 * Creates a validated file object with sanitized metadata.
 */
export async function createValidatedFile(
  file: File,
  category: UploadCategory,
): Promise<ValidatedFile | null> {
  const result = await validateUpload(file, category);
  if (!result.valid) {
    return null;
  }

  return {
    file,
    category,
    sanitizedName: sanitizeFilename(file.name),
    contentType: file.type,
  };
}

/**
 * Formats bytes into human-readable size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Gets the max file size for a category in human-readable format.
 */
export function getMaxFileSizeForCategory(category: UploadCategory): string {
  return formatFileSize(UPLOAD_CONSTRAINTS[category].maxSize);
}

/**
 * Zod schemas for upload metadata validation
 */
export const UploadMetadataSchema = z.object({
  assetId: z.string().uuid(),
  projectId: z.string().uuid(),
  fieldType: z.enum(['thumbnail', 'file', 'reference']),
  category: z.enum(['image', 'video', 'audio']),
});

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

export const UploadResponseSchema = z.object({
  url: z.string().url(),
  path: z.string(),
  size: z.number(),
  contentType: z.string(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;
