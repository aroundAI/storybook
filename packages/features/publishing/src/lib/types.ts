/**
 * Publishing Hub Types
 * Types for multi-platform video publishing
 */

export type Platform =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'linkedin';

export type PublishStatus =
  | 'pending'
  | 'publishing'
  | 'completed'
  | 'failed'
  | 'scheduled';

export type ContentType = 'full' | 'teaser' | 'trailer';

/**
 * Props for the main PublishHub component
 */
export interface PublishHubProps {
  episodeId: string;
  projectId: string;
  accountSlug: string;
  accountId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  defaultTitle: string;
  defaultDescription: string;
  duration: number; // seconds
}

/**
 * Platform connection from database
 */
export interface PlatformConnection {
  id: string;
  platform: Platform;
  platformAccountId?: string | null;
  platformAccountName: string;
  avatarUrl?: string | null;
  isActive: boolean;
  tokenValid: boolean;
  tokenExpiresAt?: string | null;
  followerCount?: number | null;
  scopes?: string[] | null;
  language: string; // Target language for this channel (en, hi, es, pt)
}

/**
 * Configuration for publishing to a specific platform
 */
export interface PlatformPublishConfig {
  platform: Platform;
  connectionId: string;
  enabled: boolean;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string;
  scheduledAt?: Date;
  platformSpecific: PlatformSpecificSettings;
  // Language for this publish (from connection or user override)
  language: string;
  // Connection info for display
  platformAccountName?: string;
  avatarUrl?: string | null;
  followerCount?: number | null;
  tokenValid?: boolean;
  accounts?: Array<{
    id: string;
    name: string;
    avatarUrl?: string;
  }>;
}

/**
 * Platform-specific settings
 */
export interface PlatformSpecificSettings {
  // YouTube
  categoryId?: string;
  playlistIds?: string[];
  privacy?: 'private' | 'unlisted' | 'public';
  madeForKids?: boolean;
  // TikTok
  disableDuet?: boolean;
  disableStitch?: boolean;
  disableComment?: boolean;
  // Instagram
  shareToFeed?: boolean;
  locationId?: string;
  // Facebook
  isReel?: boolean;
  targeting?: Record<string, unknown>;
  // Twitter
  // LinkedIn
}

/**
 * Result of publishing to a platform
 */
export interface PublishResult {
  platform: Platform;
  status: PublishStatus;
  platformContentId?: string;
  platformUrl?: string;
  error?: string;
  publishId?: string;
}

/**
 * Props for PlatformSelector component
 */
export interface PlatformSelectorProps {
  platforms: PlatformPublishConfig[];
  onToggle: (platform: Platform, enabled: boolean) => void;
  onConnect?: (platform: Platform) => void;
  onAccountChange?: (platform: Platform, connectionId: string) => void;
}

/**
 * Props for MetadataEditor component
 */
export interface MetadataEditorProps {
  platform: PlatformPublishConfig;
  onChange: (updates: Partial<PlatformPublishConfig>) => void;
  videoPreviewUrl: string;
}

/**
 * Props for ThumbnailSelector component
 */
export interface ThumbnailSelectorProps {
  currentUrl?: string;
  videoUrl: string;
  onChange: (url: string) => void;
}

/**
 * Validation result for metadata
 */
export interface ValidationResult {
  warnings: string[];
  errors: string[];
  isValid: boolean;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  accessToken?: string;
  error?: string;
  needsRefresh?: boolean;
}
