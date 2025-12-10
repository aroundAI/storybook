/**
 * Twitter/X Provider Types
 * Types for Twitter video upload and tweet management
 */

export interface TwitterUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Tweet text (max 280 characters) */
  text: string;
  /** Optional reply settings */
  replySettings?: 'everyone' | 'mentionedUsers' | 'following';
}

export interface TwitterUploadResult {
  /** Tweet ID for tracking */
  tweetId: string;
  /** Current status of the upload */
  status: 'PROCESSING' | 'PUBLISHED' | 'FAILED';
  /** URL to the tweet on Twitter */
  tweetUrl?: string;
  /** Error message if failed */
  errorMessage?: string;
}

export interface TwitterUser {
  /** Twitter user ID */
  id: string;
  /** Twitter username (handle without @) */
  username: string;
  /** Display name */
  name: string;
  /** Profile image URL */
  profileImageUrl: string;
}

export interface TwitterMediaInit {
  /** Media ID for the upload session */
  mediaId: string;
}

export type TwitterUploadProgress = (progress: number) => void;

/**
 * Twitter Video Constraints
 * Based on Twitter API documentation
 */
export const TWITTER_CONSTRAINTS = {
  /** Maximum video duration in seconds (free tier) */
  maxDuration: 140,
  /** Maximum video duration in seconds (premium tier) */
  maxDurationPremium: 240,
  /** Maximum file size in bytes (512MB) */
  maxFileSizeBytes: 512 * 1024 * 1024,
  /** Maximum tweet length in characters */
  maxTweetLength: 280,
  /** Recommended chunk size (5MB) - Twitter recommends 1-5MB */
  chunkSizeBytes: 5 * 1024 * 1024,
  /** Supported video formats */
  supportedFormats: ['mp4', 'mov'] as const,
  /** Supported aspect ratios */
  aspectRatios: ['16:9', '9:16', '1:1'] as const,
} as const;
