/**
 * Platform-specific limits and configuration
 */
import type { Platform, PlatformSpecificSettings } from './types';

/**
 * Character and content limits for each platform
 */
export interface PlatformLimits {
  titleMax: number;
  descriptionMax: number;
  tagsMax: number; // For YouTube: total characters, for TikTok/Instagram: hashtag count
  hashtagsSupported: boolean;
  schedulingSupported: boolean;
  shortsSupported: boolean;
  minShortsDuration: number;
  maxShortsDuration: number;
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  youtube: {
    titleMax: 100,
    descriptionMax: 5000,
    tagsMax: 500, // Total characters for all tags
    hashtagsSupported: false, // Uses tags instead
    schedulingSupported: true,
    shortsSupported: true,
    minShortsDuration: 15,
    maxShortsDuration: 60,
  },
  tiktok: {
    titleMax: 2200, // Caption
    descriptionMax: 0, // No separate description
    tagsMax: 100, // Number of hashtags
    hashtagsSupported: true,
    schedulingSupported: true, // Server-side scheduling
    shortsSupported: true,
    minShortsDuration: 3,
    maxShortsDuration: 600,
  },
  instagram: {
    titleMax: 2200, // Caption includes description
    descriptionMax: 0,
    tagsMax: 30, // Number of hashtags
    hashtagsSupported: true,
    schedulingSupported: true, // Server-side scheduling
    shortsSupported: true,
    minShortsDuration: 3,
    maxShortsDuration: 90,
  },
  facebook: {
    titleMax: 255,
    descriptionMax: 63206,
    tagsMax: 0, // No tags
    hashtagsSupported: false,
    schedulingSupported: true,
    shortsSupported: true, // Reels
    minShortsDuration: 3,
    maxShortsDuration: 90,
  },
  twitter: {
    titleMax: 280, // Tweet text
    descriptionMax: 0,
    tagsMax: 0,
    hashtagsSupported: true, // In tweet text
    schedulingSupported: true, // Server-side scheduling
    shortsSupported: false,
    minShortsDuration: 0,
    maxShortsDuration: 0,
  },
  linkedin: {
    titleMax: 700, // Post text
    descriptionMax: 0,
    tagsMax: 0,
    hashtagsSupported: true, // In post text
    schedulingSupported: true, // Server-side scheduling
    shortsSupported: false,
    minShortsDuration: 0,
    maxShortsDuration: 0,
  },
};

/**
 * Platform display configuration
 */
export interface PlatformConfig {
  name: string;
  color: string;
  bgColor: string;
  description: string;
}

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  youtube: {
    name: 'YouTube',
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-950',
    description: 'Videos, Shorts, Live',
  },
  tiktok: {
    name: 'TikTok',
    color: 'text-black dark:text-white',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    description: 'Videos up to 10 min',
  },
  instagram: {
    name: 'Instagram',
    color: 'text-pink-500',
    bgColor: 'bg-pink-100 dark:bg-pink-950',
    description: 'Reels, Stories',
  },
  facebook: {
    name: 'Facebook',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-950',
    description: 'Videos, Reels',
  },
  twitter: {
    name: 'X (Twitter)',
    color: 'text-black dark:text-white',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    description: 'Video posts',
  },
  linkedin: {
    name: 'LinkedIn',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100 dark:bg-blue-950',
    description: 'Professional videos',
  },
};

/**
 * YouTube video categories
 */
export const YOUTUBE_CATEGORIES = [
  { id: '1', name: 'Film & Animation' },
  { id: '2', name: 'Autos & Vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets & Animals' },
  { id: '17', name: 'Sports' },
  { id: '19', name: 'Travel & Events' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News & Politics' },
  { id: '26', name: 'Howto & Style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
  { id: '29', name: 'Nonprofits & Activism' },
];

/**
 * Shorts/Clips constraints
 */
export const SHORTS_CONSTRAINTS = {
  youtube: { minDuration: 15, maxDuration: 60, aspectRatio: '9:16' as const },
  tiktok: { minDuration: 3, maxDuration: 600, aspectRatio: '9:16' as const },
  instagram: { minDuration: 3, maxDuration: 90, aspectRatio: '9:16' as const },
  facebook: { minDuration: 3, maxDuration: 90, aspectRatio: '9:16' as const },
};

/**
 * Get default platform-specific settings
 */
export function getDefaultPlatformSettings(
  platform: Platform,
): PlatformSpecificSettings {
  switch (platform) {
    case 'youtube':
      return {
        categoryId: '22', // People & Blogs
        privacy: 'private',
        madeForKids: false,
      };
    case 'tiktok':
      return {
        disableDuet: false,
        disableStitch: false,
        disableComment: false,
      };
    case 'instagram':
      return {
        shareToFeed: true,
      };
    case 'facebook':
      return {
        isReel: false,
      };
    case 'twitter':
    case 'linkedin':
    default:
      return {};
  }
}

/**
 * Format follower count for display
 */
export function formatFollowers(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
