/**
 * LinkedIn Provider Types
 * Types for LinkedIn video upload and post management
 */

export interface LinkedInUploadInput {
  /** Local file path or URL to the video */
  videoPath: string;
  /** Post text/commentary (max 3000 characters) */
  text: string;
  /** Visibility for the post */
  visibility: 'PUBLIC' | 'CONNECTIONS';
  /** Author URN (person or organization) */
  authorUrn: string;
  /** Whether this is a company page post */
  isCompanyPage?: boolean;
}

export interface LinkedInUploadResult {
  /** LinkedIn post URN */
  postUrn: string;
  /** Current status of the upload */
  status: 'PROCESSING' | 'AVAILABLE' | 'FAILED';
  /** URL to the post on LinkedIn (available after processing) */
  postUrl?: string;
  /** Error message if failed */
  errorMessage?: string;
}

export interface LinkedInVideoStatus {
  /** Video URN */
  videoUrn: string;
  /** Processing status */
  status: 'PROCESSING' | 'AVAILABLE' | 'FAILED';
  /** Failure reason if applicable */
  failedReason?: string;
}

export interface LinkedInUser {
  /** LinkedIn person URN */
  sub: string;
  /** Full name */
  name: string;
  /** Given (first) name */
  givenName: string;
  /** Family (last) name */
  familyName: string;
  /** Profile picture URL */
  picture?: string;
  /** Email address */
  email?: string;
}

export interface LinkedInOrganization {
  /** Organization URN */
  id: string;
  /** Organization name */
  name: string;
  /** Logo URL */
  logoUrl?: string;
}

export interface LinkedInUploadInit {
  /** Upload URL for the video */
  uploadUrl: string;
  /** Video URN for tracking */
  videoUrn: string;
}

export interface LinkedInPostMetrics {
  /** Number of impressions/views */
  impressions: number;
  /** Number of likes */
  likes: number;
  /** Number of comments */
  comments: number;
  /** Number of shares */
  shares: number;
}

export type LinkedInUploadProgress = (progress: number) => void;

/**
 * LinkedIn Video and Post Constraints
 */
export const LINKEDIN_CONSTRAINTS = {
  video: {
    personal: {
      /** Maximum video duration for personal accounts (10 minutes) */
      maxDuration: 600,
      /** Maximum file size (5 GB) */
      maxSize: 5 * 1024 * 1024 * 1024,
    },
    company: {
      /** Maximum video duration for company pages (15 minutes) */
      maxDuration: 900,
      /** Maximum file size (5 GB) */
      maxSize: 5 * 1024 * 1024 * 1024,
    },
    /** Minimum video duration (3 seconds) */
    minDuration: 3,
    /** Supported aspect ratios */
    aspectRatios: ['16:9', '9:16', '1:1', '4:3'] as const,
    /** Supported video formats */
    supportedFormats: ['mp4', 'avi', 'mov', 'flv'] as const,
  },
  post: {
    /** Maximum post text length (3000 characters) */
    maxLength: 3000,
    /** Maximum number of hashtags */
    maxHashtags: 30,
  },
} as const;
