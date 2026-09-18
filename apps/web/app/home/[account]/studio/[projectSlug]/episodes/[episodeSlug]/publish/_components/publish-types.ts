import { AlertCircle, Facebook, Instagram, Youtube } from 'lucide-react';

import type { FollowerCountSource } from '@kit/publishing/lib/follower-count';

// Platform icons and configurations - with light/dark mode compatible colors
export const PLATFORM_CONFIG: Record<
  string,
  { name: string; bgColor: string; textColor: string; shortName: string }
> = {
  youtube: {
    name: 'YouTube',
    bgColor: 'bg-red-500 dark:bg-red-600',
    textColor: 'text-white',
    shortName: 'YT',
  },
  facebook: {
    name: 'Facebook',
    bgColor: 'bg-blue-600 dark:bg-blue-700',
    textColor: 'text-white',
    shortName: 'FB',
  },
  instagram: {
    name: 'Instagram',
    bgColor: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400',
    textColor: 'text-white',
    shortName: 'IG',
  },
  tiktok: {
    name: 'TikTok',
    bgColor: 'bg-gray-900 dark:bg-gray-800',
    textColor: 'text-white',
    shortName: 'TT',
  },
};

export type VideoType = 'full' | 'shorts';
export type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

// Publishing progress types
export type PublishStage =
  | 'idle'
  | 'translating'
  | 'confirm-translation'
  | 'uploading'
  | 'complete'
  | 'error';

export type TranslationResult = {
  id: string; // Unique ID: 'full-video-hi' or 'group-xxx-hi'
  contentType: 'full-video' | 'shorts-group';
  contentName: string; // Display name: 'Full Video' or group name
  language: string;
  title: string;
  description: string;
  status: 'pending' | 'translating' | 'success' | 'error';
  error?: string;
  groupId?: string; // For shorts groups
};

export type PlatformUploadStatus = {
  platform: string;
  connectionName: string;
  language: string;
  contentType: 'full' | 'short';
  status: 'pending' | 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
};

// Delete progress types
export type DeleteStage =
  | 'idle'
  | 'confirm'
  | 'deleting'
  | 'complete'
  | 'error';

export type DeleteItemStatus = {
  publishId: string;
  platform: string;
  channelName: string;
  status: 'pending' | 'deleting' | 'success' | 'error' | 'skipped';
  error?: string;
  note?: string; // For platform limitations like Instagram
};

export interface PlatformConnection {
  id: string;
  platform: Platform;
  platformAccountName: string;
  avatarUrl: string | null;
  tokenValid: boolean;
  language: string;
  /** Latest dated level, or the count stored at connection (FILM-1617). */
  followerCount?: number | null;
  followerCountSource?: FollowerCountSource | null;
  followerCountAsOf?: string | null;
  followerCountRoundingStep?: number;
}

export interface PlatformConfig {
  platform: Platform;
  connectionId: string;
  contentType: 'full' | 'short';
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string | null;
  language: string;
  shortsGroupId?: string;
  platformSpecific: Record<string, unknown>;
}

export interface ScheduledPlatformConfig extends PlatformConfig {
  scheduledAt: string;
}

export { AlertCircle, Facebook, Instagram, Youtube };
