import {
  FACEBOOK_FILE_URL_MAX_BYTES,
  PLATFORM_VIDEO_LIMITS,
} from '../../lib/platform-video-limits';

/**
 * Facebook Provider Types
 * Types for Facebook video upload and Page management
 */
export interface FacebookUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Video title */
  title: string;
  /** Video description */
  description: string;
  /** Upload as Reel (true) or regular video (false) */
  isReel: boolean;
  /**
   * `videoPath` is a public URL. Meta fetches it (`file_url`) in one call
   * when it is within Meta's 1 GB limit for that call; a larger one is
   * measured and streamed through this process in ranged chunks (KB-209).
   */
  fetchFromUrl?: boolean;
  /** Local file path or URL to custom thumbnail */
  thumbnailPath?: string;
  /** Publish immediately (true) or save as draft (false) */
  published: boolean;
  /** Schedule publish time (only if published is false) */
  scheduledPublishTime?: Date;
  /** Target audience settings */
  targeting?: FacebookTargeting;
}

export interface FacebookTargeting {
  /** Minimum age for viewers */
  ageMin?: number;
  /** Maximum age for viewers */
  ageMax?: number;
  /** Country codes to target (e.g., ['US', 'CA']) */
  geoLocations?: string[];
}

export interface FacebookUploadResult {
  /** Facebook video ID */
  videoId: string;
  /** Post ID (if published) */
  postId?: string;
  /** Current status of the video */
  status: 'processing' | 'ready' | 'published' | 'error';
  /** URL to the video on Facebook */
  videoUrl?: string;
  /** Why the thumbnail was not sent, when the video went without it (KB-210) */
  thumbnailError?: string;
}

export interface FacebookPage {
  /** Page ID */
  id: string;
  /** Page name */
  name: string;
  /** Page profile picture URL */
  pictureUrl: string;
  /** Number of page followers/fans */
  fanCount: number;
  /** Page access token (used for publishing) */
  accessToken: string;
}

export interface FacebookResumableSession {
  /** Upload session ID */
  uploadSessionId: string;
  /** Video ID (assigned at start) */
  videoId: string;
  /** Start offset for next chunk */
  startOffset: number;
  /** End offset for next chunk */
  endOffset: number;
}

export type FacebookUploadProgress = (progress: number) => void;

/**
 * Facebook Video Constraints
 */
export const FACEBOOK_CONSTRAINTS = {
  /** Maximum file size in bytes: the resumable limit, as preflight uses */
  maxFileSizeBytes: PLATFORM_VIDEO_LIMITS.facebook.maxBytes,
  /** Above this, `file_url` is refused (1 GB), so the upload is resumable */
  resumableThresholdBytes: FACEBOOK_FILE_URL_MAX_BYTES,
  /** Minimum Reel duration in seconds */
  reelMinDurationSeconds: 3,
  /** Maximum Reel duration in seconds */
  reelMaxDurationSeconds: 90,
  /** Recommended chunk size for resumable upload (based on server suggestion) */
  defaultChunkSizeBytes: 64 * 1024 * 1024,
} as const;
