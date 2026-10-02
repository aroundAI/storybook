/**
 * Twitter/X Provider Types
 * Types for Twitter video upload and tweet management
 */
import { X_VIDEO_LIMITS } from '@kit/shared/vendors';

export interface TwitterUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Tweet text (max 280 characters) */
  text: string;
  /** Optional reply settings */
  replySettings?: 'everyone' | 'mentionedUsers' | 'following';
  /** The creator declared it AI-generated: X's made-with-AI disclosure (FILM-1731) */
  madeWithAi?: boolean;
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
 * Twitter Video Constraints. The video limits are X_VIDEO_LIMITS's, the one
 * reading of X's docs (FILM-1729): this held v1.1's 140 s and 512 MB, which
 * no longer apply, and refused videos the publish screen had accepted.
 */
export const TWITTER_CONSTRAINTS = {
  maxDuration: X_VIDEO_LIMITS.maxSeconds,
  maxFileSizeBytes: X_VIDEO_LIMITS.maxBytes,
  /** Maximum tweet length, as tweetLength() counts it */
  maxTweetLength: 280,
  /** Recommended chunk size (5MB) - Twitter recommends 1-5MB */
  chunkSizeBytes: 5 * 1024 * 1024,
  /** Supported video formats */
  supportedFormats: ['mp4', 'mov'] as const,
  /** Supported aspect ratios */
  aspectRatios: ['16:9', '9:16', '1:1'] as const,
} as const;
