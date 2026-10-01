/**
 * TikTok Provider Types
 * Types for TikTok video upload and post management
 */

export interface TikTokUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Post caption (max 2200 characters) */
  caption: string;
  /** Privacy level for the post */
  privacy: 'PUBLIC' | 'FRIENDS' | 'SELF';
  /** Disable duet feature */
  disableDuet: boolean;
  /** Disable stitch feature */
  disableStitch: boolean;
  /** Disable comments */
  disableComment: boolean;
  /** Timestamp in milliseconds for thumbnail frame */
  videoCoverTimestampMs?: number;
  /** Whether content is branded/sponsored */
  brandContentToggle?: boolean;
  /** Whether branded content is organic */
  brandOrganicToggle?: boolean;
}

export interface TikTokUploadResult {
  /** TikTok publish ID for tracking */
  publishId: string;
  /** Current status of the upload */
  status: 'PROCESSING' | 'PUBLISH_COMPLETE' | 'FAILED';
  /** URL to the video on TikTok (available after processing) */
  videoUrl?: string;
  /** Error message if failed */
  errorMessage?: string;
}

export interface TikTokUser {
  /** TikTok open ID (app-specific) */
  openId: string;
  /** TikTok union ID (cross-app) */
  unionId: string;
  /** User avatar URL */
  avatarUrl: string;
  /** Display name */
  displayName: string;
  /** Number of followers */
  followerCount: number;
}

export interface TikTokUploadInit {
  /** Publish ID to track the upload with */
  publishId: string;
  /** URL to upload chunks to */
  uploadUrl: string;
}

export type TikTokUploadProgress = (progress: number) => void;

/**
 * TikTok Video Constraints
 */
export const TIKTOK_CONSTRAINTS = {
  /** Maximum video length in minutes */
  maxLengthMinutes: 10,
  /** Maximum file size in bytes (4GB) */
  maxFileSizeBytes: 4 * 1024 * 1024 * 1024,
  /** Maximum caption length in characters */
  maxCaptionLength: 2200,
  /** Recommended chunk size (10MB) */
  chunkSizeBytes: 10 * 1024 * 1024,
  /** Minimum chunk size (5MB) */
  minChunkSizeBytes: 5 * 1024 * 1024,
  /** Maximum chunk size (64MB) */
  maxChunkSizeBytes: 64 * 1024 * 1024,
} as const;
