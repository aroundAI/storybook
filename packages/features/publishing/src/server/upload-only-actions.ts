'use server';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  ExportPackage,
  Platform,
  UploadStep,
} from '../lib/export-package-types';
import {
  GenerateExportPackageSchema,
  MarkAsExternallyUploadedSchema,
} from '../lib/schemas/upload-only.schema';

/**
 * Platform-specific upload instructions
 */
const PLATFORM_INSTRUCTIONS: Record<Platform, UploadStep[]> = {
  youtube: [
    {
      step: 1,
      action: 'Go to YouTube Studio',
      link: 'https://studio.youtube.com',
    },
    { step: 2, action: 'Click Create > Upload video' },
    { step: 3, action: 'Select your downloaded video file' },
    { step: 4, action: 'Paste the title and description' },
    { step: 5, action: 'Upload the thumbnail image' },
    { step: 6, action: 'Add tags in the "More options" section' },
    { step: 7, action: 'Set visibility and publish' },
  ],
  tiktok: [
    {
      step: 1,
      action: 'Go to TikTok Creator Center',
      link: 'https://www.tiktok.com/creator',
    },
    { step: 2, action: 'Click Upload' },
    { step: 3, action: 'Select your downloaded video file' },
    { step: 4, action: 'Paste the caption (title + description + tags)' },
    { step: 5, action: 'Select a cover frame or upload thumbnail' },
    { step: 6, action: 'Configure duet/stitch settings if needed' },
    { step: 7, action: 'Post your video' },
  ],
  instagram: [
    {
      step: 1,
      action: 'Go to Creator Studio',
      link: 'https://business.facebook.com/creatorstudio',
    },
    { step: 2, action: 'Select your Instagram account' },
    { step: 3, action: 'Click Create Post > Reels' },
    { step: 4, action: 'Upload your downloaded video file' },
    { step: 5, action: 'Paste the caption' },
    { step: 6, action: 'Upload cover image' },
    { step: 7, action: 'Share to Reels' },
  ],
  facebook: [
    {
      step: 1,
      action: 'Go to Creator Studio',
      link: 'https://business.facebook.com/creatorstudio',
    },
    { step: 2, action: 'Select your Facebook Page' },
    { step: 3, action: 'Click Create Post > Video' },
    { step: 4, action: 'Upload your downloaded video file' },
    { step: 5, action: 'Paste title and description' },
    { step: 6, action: 'Upload thumbnail image' },
    { step: 7, action: 'Publish or schedule' },
  ],
};

/**
 * Regex patterns for extracting content IDs from platform URLs
 */
const CONTENT_ID_PATTERNS: Record<Platform, RegExp> = {
  youtube: /(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  tiktok: /video\/(\d+)/,
  instagram: /(?:reel|p)\/([a-zA-Z0-9_-]+)/,
  facebook: /videos\/(\d+)/,
};

/**
 * Extract platform-specific content ID from URL
 * @returns The extracted content ID, or null if the URL format is not recognized
 */
export function extractContentId(
  url: string,
  platform: Platform,
  logger?: { warn: (ctx: Record<string, unknown>, msg: string) => void },
): string | null {
  const pattern = CONTENT_ID_PATTERNS[platform];
  const match = url.match(pattern);
  const contentId = match?.[1] ?? null;

  if (!contentId && logger) {
    logger.warn(
      { url, platform },
      'Could not extract content ID from URL. Analytics tracking may be limited.',
    );
  }

  return contentId;
}

/**
 * Sanitize filename for safe download
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .toLowerCase()
    .slice(0, 100); // Limit length
}

/**
 * Format description for specific platform requirements
 */
export function formatDescriptionForPlatform(
  description: string,
  platform: Platform,
): string {
  switch (platform) {
    case 'tiktok':
    case 'instagram':
      // These platforms have shorter character limits and prefer hashtags
      return description.slice(0, 2200);
    case 'youtube':
      // YouTube allows longer descriptions
      return description.slice(0, 5000);
    case 'facebook':
      return description.slice(0, 63206);
    default:
      return description;
  }
}

/**
 * Generate default tags from episode data
 */
export function generateDefaultTags(
  episode: {
    title?: string | null;
    description?: string | null;
    metadata?: unknown;
  },
  _platform: Platform,
): string[] {
  const tags: string[] = [];

  // Extract potential tags from title
  if (episode.title) {
    const titleWords = episode.title
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 5);
    tags.push(...titleWords);
  }

  // Check for existing tags in metadata
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  if (metadata?.tags && Array.isArray(metadata.tags)) {
    tags.push(...(metadata.tags as string[]));
  }

  // Return unique tags
  return [...new Set(tags)].slice(0, 30);
}

/**
 * Generate an export package for manual platform upload
 */
export const generateExportPackageAction = enhanceAction(
  async ({ episodeId, platform }, user) => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.generateExportPackage',
      episodeId,
      platform,
      userId: user.id,
    };

    logger.info(ctx, 'Generating export package');

    const client = getSupabaseServerClient();

    // Get episode with related data
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select(
        `
        *,
        publishes (*)
      `,
      )
      .eq('id', episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // Check if video is ready
    if (!episode.final_video_url) {
      logger.warn(ctx, 'Video not ready for export');
      throw new Error('Video is not ready. Please finalize the video first.');
    }

    // Get existing publish record for this platform (if any)
    const existingPublish = (
      episode.publishes as Array<{
        platform: string;
        title?: string;
        description?: string;
        tags?: string[];
        metadata?: Record<string, unknown>;
      }>
    )?.find((p) => p.platform === platform);

    // Prepare metadata with fallback for title
    const title = existingPublish?.title ?? episode.title ?? 'untitled-video';
    const description = formatDescriptionForPlatform(
      existingPublish?.description ?? episode.description ?? '',
      platform,
    );
    const tags =
      existingPublish?.tags ?? generateDefaultTags(episode, platform);

    // Build export package
    const exportPackage: ExportPackage = {
      episodeId,
      platform,
      generatedAt: new Date().toISOString(),
      video: {
        url: episode.final_video_url,
        filename: `${sanitizeFilename(title)}.mp4`,
        format: 'mp4',
        resolution: '1080p',
        duration: episode.duration_seconds ?? 0,
      },
      thumbnail: episode.thumbnail_url
        ? {
            url: episode.thumbnail_url,
            filename: `${sanitizeFilename(title)}_thumbnail.jpg`,
            dimensions: { width: 1280, height: 720 }, // Default YouTube thumbnail size
          }
        : null,
      metadata: {
        title,
        description,
        tags,
        category: (existingPublish?.metadata as Record<string, unknown>)
          ?.category as string | undefined,
      },
      uploadInstructions: PLATFORM_INSTRUCTIONS[platform],
    };

    logger.info(ctx, 'Export package generated successfully');

    return exportPackage;
  },
  {
    schema: GenerateExportPackageSchema,
    auth: true,
  },
);

/**
 * Mark content as externally uploaded and save the platform URL
 */
export const markAsExternallyUploadedAction = enhanceAction(
  async ({ episodeId, platform, platformUrl }, user) => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.markAsExternallyUploaded',
      episodeId,
      platform,
      platformUrl,
      userId: user.id,
    };

    logger.info(ctx, 'Marking as externally uploaded');

    const client = getSupabaseServerClient();

    // Extract platform content ID from URL if possible
    const platformContentId = extractContentId(platformUrl, platform, logger);

    // Check for existing publish record
    const { data: existingPublish } = await client
      .from('publishes')
      .select('id')
      .eq('episode_id', episodeId)
      .eq('platform', platform)
      .maybeSingle();

    let publishId: string;

    if (existingPublish) {
      // Update existing record
      const { data: updated, error: updateError } = await client
        .from('publishes')
        .update({
          platform_url: platformUrl,
          platform_content_id: platformContentId,
          status: 'published',
          published_at: new Date().toISOString(),
          metadata: { upload_method: 'external' },
        })
        .eq('id', existingPublish.id)
        .select('id')
        .single();

      if (updateError) {
        logger.error(
          { ...ctx, error: updateError },
          'Failed to update publish',
        );
        throw new Error('Failed to update publish record');
      }

      publishId = updated.id;
    } else {
      // Create new record for external upload (no OAuth connection required)
      // Migration 20251210164448 makes platform_connection_id nullable for external uploads
      // TODO: Remove type override after running `pnpm supabase:web:typegen` to regenerate types
      const { data: created, error: createError } = await client
        .from('publishes')
        .insert({
          episode_id: episodeId,
          platform,
          platform_url: platformUrl,
          platform_content_id: platformContentId,
          // Type override: platform_connection_id is nullable after migration 20251210164448
          // The generated types still show it as required until typegen is run
          platform_connection_id: null as unknown as string,
          status: 'published',
          published_at: new Date().toISOString(),
          metadata: { upload_method: 'external' },
        })
        .select('id')
        .single();

      if (createError) {
        logger.error(
          { ...ctx, error: createError },
          'Failed to create publish',
        );
        throw new Error('Failed to create publish record');
      }

      publishId = created.id;
    }

    logger.info({ ...ctx, publishId }, 'Marked as externally uploaded');

    return { publishId };
  },
  {
    schema: MarkAsExternallyUploadedSchema,
    auth: true,
  },
);
