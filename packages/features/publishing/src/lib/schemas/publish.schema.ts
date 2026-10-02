/**
 * Publishing schemas for validation
 */
import { z } from 'zod';

/**
 * Platform enum
 */
export const PlatformSchema = z.enum([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
]);

/**
 * Platform-specific settings schema
 */
export const PlatformSpecificSettingsSchema = z.object({
  // YouTube
  categoryId: z.string().optional(),
  playlistIds: z.array(z.string().uuid()).optional(),
  privacy: z.enum(['private', 'unlisted', 'public']).optional(),
  madeForKids: z.boolean().optional(),
  // TikTok
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
  disableComment: z.boolean().optional(),
  // Instagram
  shareToFeed: z.boolean().optional(),
  locationId: z.string().optional(),
  // Facebook
  isReel: z.boolean().optional(),
  targeting: z.record(z.unknown()).optional(),
});

/**
 * Platform config for a single publish
 */
export const PlatformConfigSchema = z.object({
  platform: PlatformSchema,
  connectionId: z.string().uuid(),
  // Content type: 'full' for long-form videos, 'short' for shorts/reels
  contentType: z.enum(['full', 'short']).default('full'),
  // Shorts group ID: identifies which shorts group to use (required when contentType is 'short')
  // Note: group IDs are like 'group-1234567890' not UUIDs
  shortsGroupId: z.string().optional().nullable(),
  title: z.string().min(1).max(5000),
  description: z.string().max(70000).default(''),
  tags: z.array(z.string()).default([]),
  thumbnailUrl: z.string().url().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  platformSpecific: PlatformSpecificSettingsSchema.default({}),
  // Language of the asset being published (en, hi, es, pt, etc.). Optional
  // with no default: a default here stamped 'en' on every request that
  // omitted it, before the server's own fallback to the channel's target
  // could run — so that fallback was dead code, and the analytics could not
  // tell a chosen English from an unset one (FILM-1702).
  language: z.string().min(2).max(5).optional(),
});

/**
 * Schema for publishToAllAction
 */
export const PublishToAllSchema = z.object({
  episodeId: z.string().uuid(),
  platforms: z.array(PlatformConfigSchema).min(1),
  // FILM-1731: the creator's AI declaration, one for the whole publish.
  // Absent is "not declared": off, as the publish screen's option starts.
  aiGenerated: z.boolean().optional(),
});

/**
 * Schema for getConnectedPlatforms action
 */
export const GetConnectedPlatformsSchema = z.object({
  accountId: z.string().uuid(),
});

/**
 * Schema for getPublishStatus action
 */
export const GetPublishStatusSchema = z.object({
  episodeId: z.string().uuid(),
});

/**
 * Schema for retryPublish action
 */
export const RetryPublishSchema = z.object({
  publishId: z.string().uuid(),
});

/**
 * Type exports
 */
export type PlatformConfigInput = z.infer<typeof PlatformConfigSchema>;
export type PublishToAllInput = z.infer<typeof PublishToAllSchema>;
