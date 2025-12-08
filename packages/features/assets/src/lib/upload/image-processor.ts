import 'server-only';

import sharp from 'sharp';

/**
 * Image dimension constraints interface
 */
export interface ImageDimensionConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Default image dimension constraints for upload validation
 */
export const IMAGE_DIMENSION_CONSTRAINTS: ImageDimensionConstraints = {
  minWidth: 512,
  minHeight: 512,
  maxWidth: 4096,
  maxHeight: 4096,
};

/**
 * Default thumbnail size
 */
export const THUMBNAIL_SIZE = 256;

/**
 * Image dimensions result
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Dimension validation result
 */
export interface DimensionValidationResult {
  valid: boolean;
  error?: {
    code: 'DIMENSIONS_TOO_SMALL' | 'DIMENSIONS_TOO_LARGE';
    message: string;
    details: {
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
      maxWidth: number;
      maxHeight: number;
    };
  };
}

/**
 * Get image dimensions from a buffer
 */
export async function getImageDimensions(
  buffer: Buffer,
): Promise<ImageDimensions | null> {
  try {
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch {
    return null;
  }
}

/**
 * Validate image dimensions against min/max constraints
 */
export async function validateImageDimensions(
  buffer: Buffer,
  constraints = IMAGE_DIMENSION_CONSTRAINTS,
): Promise<DimensionValidationResult> {
  const dimensions = await getImageDimensions(buffer);

  if (!dimensions) {
    return {
      valid: false,
      error: {
        code: 'DIMENSIONS_TOO_SMALL',
        message: 'Could not read image dimensions. The file may be corrupted.',
        details: {
          width: 0,
          height: 0,
          ...constraints,
        },
      },
    };
  }

  const { width, height } = dimensions;
  const { minWidth, minHeight, maxWidth, maxHeight } = constraints;

  // Check minimum dimensions
  if (width < minWidth || height < minHeight) {
    return {
      valid: false,
      error: {
        code: 'DIMENSIONS_TOO_SMALL',
        message: `Image dimensions (${width}x${height}) are below minimum (${minWidth}x${minHeight})`,
        details: {
          width,
          height,
          ...constraints,
        },
      },
    };
  }

  // Check maximum dimensions
  if (width > maxWidth || height > maxHeight) {
    return {
      valid: false,
      error: {
        code: 'DIMENSIONS_TOO_LARGE',
        message: `Image dimensions (${width}x${height}) exceed maximum (${maxWidth}x${maxHeight})`,
        details: {
          width,
          height,
          ...constraints,
        },
      },
    };
  }

  return { valid: true };
}

/**
 * Generate a thumbnail from an image buffer
 * Uses cover fit to maintain aspect ratio and fill the target dimensions
 */
export async function generateThumbnail(
  buffer: Buffer,
  size = THUMBNAIL_SIZE,
): Promise<Buffer> {
  return sharp(buffer)
    .resize(size, size, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Get the content type for a thumbnail
 * Always returns webp since we convert thumbnails to webp
 */
export function getThumbnailContentType(): string {
  return 'image/webp';
}
