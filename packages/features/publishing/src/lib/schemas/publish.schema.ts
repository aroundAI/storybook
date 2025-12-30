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
  title: z.string().min(1).max(5000),
  description: z.string().max(70000).default(''),
  tags: z.array(z.string()).default([]),
  thumbnailUrl: z.string().url().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  platformSpecific: PlatformSpecificSettingsSchema.default({}),
  // Language for multi-language analytics (en, hi, es, pt, etc.)
  language: z.string().min(2).max(5).default('en'),
});

/**
 * Schema for publishToAllAction
 */
export const PublishToAllSchema = z.object({
  episodeId: z.string().uuid(),
  platforms: z.array(PlatformConfigSchema).min(1),
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
