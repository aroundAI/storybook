import 'server-only';

// =============================================================================
// Types
// =============================================================================

export interface EpisodePublishingConfig {
  id: string;
  episodeId: string;
  platformConnectionId: string;
  language: string;
  titleOverride: string | null;
  descriptionOverride: string | null;
  tagsOverride: string[] | null;
  thumbnailOverrideUrl: string | null;
  publishImmediately: boolean;
  scheduledPublishAt: string | null;
  isEnabled: boolean;
  lastPublishedAt: string | null;
  lastPublishedVideoId: string | null;
  // Joined from platform_connections
  platform?: string;
  platformAccountName?: string;
}

export interface PlatformConnection {
  id: string;
  platform: string;
  platformAccountId: string | null;
  platformAccountName: string | null;
  language: string | null;
  isActive: boolean;
}
