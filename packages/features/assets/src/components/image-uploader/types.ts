/**
 * Image Uploader Types (FILM-207)
 *
 * Shared type definitions for the image uploader component.
 */

/**
 * Upload state machine states
 */
export type UploadState =
  | 'idle'
  | 'dragging'
  | 'validating'
  | 'uploading'
  | 'success'
  | 'error';

/**
 * Props for the main ImageUploader component
 */
export interface ImageUploaderProps {
  /** Project ID for the upload endpoint */
  projectId: string;
  /** Type of asset being uploaded */
  assetType: 'character' | 'location' | 'voice';
  /** Optional asset ID for updating existing assets */
  assetId?: string;
  /** Initial image URL to display (for existing images) */
  initialImageUrl?: string;
  /** Initial thumbnail URL to display */
  initialThumbnailUrl?: string;
  /** Callback when upload completes successfully */
  onUploadComplete?: (url: string, thumbnailUrl: string) => void;
  /** Callback when image is removed */
  onRemove?: () => void;
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number;
  /** Accepted MIME types (default: PNG, JPG, JPEG, WebP) */
  acceptedTypes?: string[];
  /** Additional CSS class names */
  className?: string;
  /** Whether the uploader is disabled */
  disabled?: boolean;
}

/**
 * Upload progress information
 */
export interface UploadProgress {
  /** Bytes uploaded so far */
  loaded: number;
  /** Total bytes to upload */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
}

/**
 * Response from the upload API endpoint
 */
export interface UploadResponse {
  success: boolean;
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  size: number;
  contentType: string;
  path: string;
}

/**
 * Upload error information
 */
export interface UploadError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Information about an uploaded image
 */
export interface ImageInfo {
  /** Full-size image URL */
  url: string;
  /** Thumbnail URL (256x256) */
  thumbnailUrl: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** File size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Original filename */
  name: string;
}

/**
 * Options for the useImageUpload hook
 */
export interface UseImageUploadOptions {
  /** Project ID for the upload endpoint */
  projectId: string;
  /** Type of asset being uploaded */
  assetType: 'character' | 'location' | 'voice';
  /** Optional asset ID for updating existing assets */
  assetId?: string;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Accepted MIME types */
  acceptedTypes?: string[];
  /** Callback when upload completes successfully */
  onUploadComplete?: (url: string, thumbnailUrl: string) => void;
}

/**
 * Return value from the useImageUpload hook
 */
export interface UseImageUploadReturn {
  /** Current upload state */
  state: UploadState;
  /** Upload progress information */
  progress: UploadProgress;
  /** Information about the uploaded image */
  imageInfo: ImageInfo | null;
  /** Error information if upload failed */
  error: UploadError | null;
  /** Upload a file */
  upload: (file: File) => Promise<void>;
  /** Cancel the current upload */
  cancel: () => void;
  /** Reset to idle state */
  reset: () => void;
  /** Validate a file without uploading */
  validate: (file: File) => Promise<{ valid: boolean; error?: UploadError }>;
}
