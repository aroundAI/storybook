export {
  getImageDimensions,
  validateImageDimensions,
  generateThumbnail,
  getThumbnailContentType,
  IMAGE_DIMENSION_CONSTRAINTS,
  THUMBNAIL_SIZE,
  type ImageDimensions,
  type ImageDimensionConstraints,
  type DimensionValidationResult,
} from './image-processor';

export {
  uploadToStorage,
  getPublicUrl,
  deleteFromStorage,
  bucketExists,
  PROJECT_ASSETS_BUCKET,
  type UploadResult,
  type UploadOptions,
} from './storage-client';
