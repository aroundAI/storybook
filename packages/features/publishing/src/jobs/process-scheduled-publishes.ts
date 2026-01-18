'use server';

import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { ensureValidToken } from '../lib/token-refresh';
import type { Platform } from '../lib/types';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { LinkedInProvider } from '../providers/linkedin';
import { TikTokProvider } from '../providers/tiktok';
import { TwitterProvider } from '../providers/twitter';
import { YouTubeProvider } from '../providers/youtube';

/**
 * Result of the scheduled publish processing job
 */
export interface ProcessScheduledResult {
  processed: number;
  published: number;
  failed: number;
}

/**
 * Scheduled publish record from database
 */
interface ScheduledPublish {
  id: string;
  episode_id: string;
  platform_connection_id: string;
  platform: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  metadata: Record<string, unknown> | null;
  episodes: {
    final_video_url: string | null;
    thumbnail_url: string | null;
  } | null;
}

/**
 * Processes scheduled publishes that are due.
 * This job should run every minute via cron.
 *
 * For platforms without native scheduling (TikTok, Instagram, Twitter, LinkedIn),
 * we store the scheduled_at time and this job publishes when the time comes.
 *
 * @returns Statistics about the processing job
 */
export async function processScheduledPublishes(): Promise<ProcessScheduledResult> {
  const logger = await getLogger();
  const ctx = { name: 'scheduled-publish.job' };
  const client = getSupabaseServerAdminClient();
  const now = new Date();

  // Find scheduled publishes that are due
  const { data: duePublishes, error } = await client
    .from('publishes')
    .select(
      `
      id,
      episode_id,
      platform_connection_id,
      platform,
      title,
      description,
      tags,
      thumbnail_url,
      metadata,
      episodes(final_video_url, thumbnail_url)
    `,
    )
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(10); // Process 10 at a time to avoid timeout

  if (error) {
    logger.error(
      { ...ctx, error: error.message },
      'Failed to query scheduled publishes',
    );
    return { processed: 0, published: 0, failed: 0 };
  }

  if (!duePublishes || duePublishes.length === 0) {
    logger.debug(ctx, 'No scheduled publishes due');
    return { processed: 0, published: 0, failed: 0 };
  }

  logger.info(
    { ...ctx, count: duePublishes.length },
    'Processing scheduled publishes',
  );

  const results: ProcessScheduledResult = {
    processed: duePublishes.length,
    published: 0,
    failed: 0,
  };

  // Process each publish
  for (const publish of duePublishes as unknown as ScheduledPublish[]) {
    const publishCtx = {
      ...ctx,
      publishId: publish.id,
      platform: publish.platform,
    };

    try {
      // Update status to publishing
      await client
        .from('publishes')
        .update({ status: 'publishing' })
        .eq('id', publish.id);

      // Get valid access token using refresh logic
      const tokenResult = await ensureValidToken(
        publish.platform_connection_id,
      );
      if (!tokenResult.valid || !tokenResult.accessToken) {
        throw new Error(
          tokenResult.error || 'Failed to get valid access token',
        );
      }

      // Get platform account ID
      const { data: connection, error: connError } = await client
        .from('platform_connections')
        .select('platform_account_id')
        .eq('id', publish.platform_connection_id)
        .single();

      if (connError || !connection) {
        throw new Error('Platform connection not found');
      }

      const episode = publish.episodes;
      if (!episode?.final_video_url) {
        throw new Error('Episode video not available');
      }

      // Execute the platform upload
      const uploadResult = await uploadToPlatform(
        publish.platform as Platform,
        tokenResult.accessToken,
        connection.platform_account_id ?? '',
        {
          videoUrl: episode.final_video_url,
          title: publish.title ?? '',
          description: publish.description ?? '',
          tags: publish.tags ?? [],
          thumbnailUrl: publish.thumbnail_url ?? episode.thumbnail_url,
          platformSpecific: publish.metadata ?? {},
        },
      );

      // Update with success
      await client
        .from('publishes')
        .update({
          status: 'published',
          platform_content_id: uploadResult.contentId,
          platform_url: uploadResult.url,
          published_at: new Date().toISOString(),
        })
        .eq('id', publish.id);

      results.published++;
      logger.info(
        { ...publishCtx, url: uploadResult.url },
        'Scheduled publish completed',
      );
    } catch (err) {
      results.failed++;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Update with failure
      await client
        .from('publishes')
        .update({
          status: 'failed',
          metadata: {
            ...(publish.metadata ?? {}),
            error: errorMessage,
            failedAt: new Date().toISOString(),
          },
        })
        .eq('id', publish.id);

      logger.error(
        { ...publishCtx, error: errorMessage },
        'Scheduled publish failed',
      );
    }

    // Small delay between publishes to avoid rate limiting
    await sleep(500);
  }

  logger.info(
    { ...ctx, ...results },
    `Scheduled publish job complete: ${results.published}/${results.processed} published, ${results.failed} failed`,
  );

  return results;
}

/**
 * Upload video to a specific platform
 */
async function uploadToPlatform(
  platform: Platform,
  accessToken: string,
  accountId: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    thumbnailUrl?: string | null;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  switch (platform) {
    case 'youtube':
      return uploadToYouTube(accessToken, options);
    case 'tiktok':
      return uploadToTikTok(accessToken, options);
    case 'instagram':
      return uploadToInstagram(accessToken, accountId, options);
    case 'facebook':
      return uploadToFacebook(accessToken, accountId, options);
    case 'twitter':
      return uploadToTwitter(accessToken, options);
    case 'linkedin':
      return uploadToLinkedIn(accessToken, accountId, options);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function uploadToYouTube(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    thumbnailUrl?: string | null;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new YouTubeProvider(accessToken);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    title: options.title,
    description: options.description,
    tags: options.tags,
    categoryId: (options.platformSpecific.categoryId as string) ?? '22',
    privacy:
      (options.platformSpecific.privacy as 'private' | 'unlisted' | 'public') ??
      'private',
    madeForKids: (options.platformSpecific.madeForKids as boolean) ?? false,
    thumbnailPath: options.thumbnailUrl ?? undefined,
  });

  return { contentId: result.videoId, url: result.videoUrl ?? '' };
}

async function uploadToTikTok(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new TikTokProvider(accessToken);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    caption: options.title,
    privacy: 'PUBLIC',
    disableDuet: (options.platformSpecific.disableDuet as boolean) ?? false,
    disableStitch: (options.platformSpecific.disableStitch as boolean) ?? false,
    disableComment:
      (options.platformSpecific.disableComment as boolean) ?? false,
  });

  return { contentId: result.publishId, url: result.videoUrl ?? '' };
}

async function uploadToInstagram(
  accessToken: string,
  accountId: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new InstagramProvider(accessToken, accountId);
  const result = await provider.uploadReel({
    videoUrl: options.videoUrl,
    caption: `${options.title}\n\n${options.description}`,
    shareToFeed: (options.platformSpecific.shareToFeed as boolean) ?? true,
    locationId: options.platformSpecific.locationId as string | undefined,
  });

  return { contentId: result.mediaId, url: result.permalink ?? '' };
}

async function uploadToFacebook(
  accessToken: string,
  pageId: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new FacebookProvider(accessToken, pageId);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    title: options.title,
    description: options.description,
    isReel: (options.platformSpecific.isReel as boolean) ?? false,
    published: true, // For scheduled posts, we're publishing now
  });

  return { contentId: result.videoId, url: result.videoUrl ?? '' };
}

async function uploadToTwitter(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new TwitterProvider(accessToken);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    text: options.title,
  });

  return { contentId: result.tweetId, url: result.tweetUrl ?? '' };
}

async function uploadToLinkedIn(
  accessToken: string,
  authorUrn: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new LinkedInProvider(accessToken);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    text: `${options.title}\n\n${options.description}`,
    visibility: 'PUBLIC',
    authorUrn,
  });

  return { contentId: result.postUrn, url: result.postUrl ?? '' };
}

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
