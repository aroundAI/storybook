// One definition, in ../types (KB-22 added 'disconnected'; two copies had drifted apart).
import type { ConnectionStatus } from '../types';
/**
 * Publishing Hub Types
 * Types for multi-platform video publishing
 */
import type { Platform } from './platforms';

export type { Platform };

export type { ConnectionStatus };

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
 * Where a follower badge's figure came from (FILM-1617): a measured
 * snapshot, a level reconstructed from daily movement, or the count stored
 * when the account was connected.
 */
export type FollowerCountSource = 'snapshot' | 'reconstructed' | 'metadata';

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
  followerCountSource?: FollowerCountSource | null;
  followerCountAsOf?: string | null;
  followerCountRoundingStep?: number;
  scopes?: string[] | null;
  language: string; // Target language for this channel (en, hi, es, pt)
  /** KB-30: the channel's YouTube audience and category; null = not declared yet. */
  youtubeMadeForKids?: boolean | null;
  youtubeCategoryId?: string | null;
  // Unified fields for compatibility with Settings page
  status?: ConnectionStatus;
  errorMessage?: string;
  profileImageUrl?: string;
  accountName?: string;
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
  followerCountSource?: FollowerCountSource | null;
  followerCountAsOf?: string | null;
  followerCountRoundingStep?: number;
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
  /** The token code behind `error`, for support (KB-157). */
  errorCode?: string;
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
