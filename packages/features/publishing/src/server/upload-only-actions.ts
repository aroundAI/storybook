'use server';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
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
import {
  extractContentId,
  formatDescriptionForPlatform,
  generateDefaultTags,
  sanitizeFilename,
} from '../lib/upload-only-format';

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
 * Generate an export package for manual platform upload
 */
const generateExportPackageHandler = enhanceAction(
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
      throw new ActionRefusal('Episode not found');
    }

    // Check if video is ready
    if (!episode.final_video_url) {
      logger.warn(ctx, 'Video not ready for export');
      throw new ActionRefusal(
        'Video is not ready. Please finalize the video first.',
      );
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

export const generateExportPackageAction = returnRefusals(
  generateExportPackageHandler,
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
