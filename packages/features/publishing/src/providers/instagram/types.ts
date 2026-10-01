/**
 * Instagram Provider Types
 * Types for Instagram Reels publishing via the Facebook Graph API
 */

/**
 * Instagram upload constraints
 */
export const INSTAGRAM_CONSTRAINTS = {
  /** Maximum caption length in characters */
  maxCaptionLength: 2200,
  /** Minimum video duration in seconds */
  minDurationSeconds: 0.5,
  /** Maximum video duration in seconds (15 minutes) */
  maxDurationSeconds: 15 * 60,
  /** Maximum polling attempts (5 minutes with 5s intervals) */
  maxPollingAttempts: 60,
  /** Polling interval in milliseconds */
  pollingIntervalMs: 5000,
  /** Reads of a just-published Reel before giving up on its permalink */
  permalinkAttempts: 10,
  /** Wait between those reads */
  permalinkIntervalMs: 2000,
} as const;

/**
 * Input for uploading a Reel to Instagram
 */
export interface InstagramUploadInput {
  /** Video URL - must be publicly accessible (not local file) */
  videoUrl: string;
  /** Caption text with hashtags and mentions - max 2200 chars */
  caption: string;
  /** Custom cover image URL */
  coverUrl?: string;
  /** Whether to share the Reel to the profile feed */
  shareToFeed: boolean;
  /** Facebook Place ID for location tagging */
  locationId?: string;
  /** User IDs to tag as collaborators */
  collaborators?: string[];
}

/**
 * Result of an Instagram Reel upload
 */
export interface InstagramUploadResult {
  /** The published media ID */
  mediaId: string;
  /** The container ID used during upload */
  containerId: string;
  /** Final status of the upload */
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR';
  /** Permalink to the published Reel */
  permalink?: string;
  /** Error message if status is ERROR */
  errorMessage?: string;
}

/**
 * Instagram account information
 */
export interface InstagramAccount {
  /** Instagram account ID */
  id: string;
  /** Instagram username */
  username: string;
  /** Display name */
  name: string;
  /** Profile picture URL */
  profilePictureUrl: string;
  /** Follower count */
  followersCount: number;
}

/**
 * Container status response from Instagram API
 */
export interface InstagramContainerStatus {
  /** Status code: IN_PROGRESS, FINISHED, ERROR */
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR';
  /** Error message if status is ERROR */
  error?: string;
}

/**
 * Location search result
 */
export interface InstagramLocation {
  /** Facebook Place ID */
  id: string;
  /** Location name */
  name: string;
}
