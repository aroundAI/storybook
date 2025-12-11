/**
 * Export Package Types for Upload-Only Mode
 * Types for generating downloadable export packages with metadata for manual platform uploads
 */

/**
 * Supported publishing platforms
 */
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

/**
 * Video information for export package
 */
export interface ExportVideo {
  /** Downloadable video URL */
  url: string;
  /** Suggested filename for download */
  filename: string;
  /** Video format (e.g., 'mp4') */
  format: string;
  /** Video resolution (e.g., '1080p') */
  resolution: string;
  /** Duration in seconds */
  duration: number;
}

/**
 * Thumbnail information for export package
 */
export interface ExportThumbnail {
  /** Downloadable thumbnail URL */
  url: string;
  /** Suggested filename for download */
  filename: string;
  /** Image dimensions */
  dimensions: {
    width: number;
    height: number;
  };
}

/**
 * Platform-specific metadata for publishing
 */
export interface PlatformMetadata {
  /** Video/post title */
  title: string;
  /** Video/post description */
  description: string;
  /** Tags/hashtags for discoverability */
  tags: string[];
  /** Content category (platform-specific) */
  category?: string;
  /** Initial visibility setting */
  visibility?: 'public' | 'unlisted' | 'private';
  /** Scheduled publish time (ISO 8601) */
  scheduledTime?: string;
  /** Additional platform-specific fields */
  platformSpecific?: Record<string, unknown>;
}

/**
 * Single step in the upload instructions checklist
 */
export interface UploadStep {
  /** Step number (1-based) */
  step: number;
  /** Action to perform */
  action: string;
  /** Additional details or tips */
  details?: string;
  /** External link for this step */
  link?: string;
}

/**
 * Complete export package for manual platform upload
 */
export interface ExportPackage {
  /** Episode ID this package is for */
  episodeId: string;
  /** Target platform */
  platform: Platform;
  /** Timestamp when package was generated (ISO 8601) */
  generatedAt: string;
  /** Video file information */
  video: ExportVideo;
  /** Thumbnail image information (optional - some episodes may not have thumbnails) */
  thumbnail: ExportThumbnail | null;
  /** Platform-formatted metadata */
  metadata: PlatformMetadata;
  /** Step-by-step upload instructions */
  uploadInstructions: UploadStep[];
}

/**
 * Platform upload page URLs
 */
export const PLATFORM_UPLOAD_URLS: Record<Platform, string> = {
  youtube: 'https://studio.youtube.com/channel/UC/videos/upload',
  tiktok: 'https://www.tiktok.com/creator#/upload',
  instagram: 'https://business.facebook.com/creatorstudio',
  facebook: 'https://business.facebook.com/creatorstudio',
};

/**
 * Platform display names
 */
export const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
};
