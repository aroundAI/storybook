import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  SCHEDULED_JOB_PRECEDENCE,
  resolveEpisodeVideo,
} from '../lib/episode-video';
import {
  EPISODE_VIDEO_PUBLISH_REFUSAL,
  ownedEpisodeVideo,
} from '../lib/owned-episode-video';
import { ownedEpisodeThumbnail } from '../lib/owned-thumbnail';
import { TokenRefusal, tokenErrorCodeOf } from '../lib/token-errors';
import { ensureValidToken } from '../lib/token-refresh';
import type { Platform } from '../lib/types';
import { recordUploadedFileDuration } from '../lib/uploaded-file-duration';
import type { YouTubeChannelDeclaration } from '../lib/youtube-declaration';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { TikTokProvider } from '../providers/tiktok';
import { TwitterProvider } from '../providers/twitter';
import { uploadToYouTube } from '../server/youtube-upload';

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
  language: string | null;
  content_type: string | null;
  ai_generated: boolean;
  episodes: {
    project_id: string;
    final_video_url: string | null;
    thumbnail_url: string | null;
    localized_videos: Record<string, string> | null;
    shorts_groups: Array<{ id: string; videos: Record<string, string> }> | null;
  } | null;
}

/**
 * Retry helper for transient network failures
 * Uses exponential backoff: 1s, 2s, 4s
 */
async function queryWithRetry<T>(
  queryFn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  logger: Awaited<ReturnType<typeof getLogger>>,
  ctx: Record<string, unknown>,
  maxRetries = 3,
  baseDelay = 1000,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let lastError: { message: string } | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await queryFn();

      // If no error, return immediately
      if (!result.error) {
        return result;
      }

      // Check if it's a transient network error worth retrying
      const isTransient =
        result.error.message?.includes('fetch failed') ||
        result.error.message?.includes('ECONNRESET') ||
        result.error.message?.includes('ETIMEDOUT') ||
        result.error.message?.includes('socket hang up');

      if (!isTransient) {
        // Not a transient error, return immediately
        return result;
      }

      lastError = result.error;
    } catch (err) {
      // Handle thrown errors (not Supabase errors)
      const message = err instanceof Error ? err.message : String(err);
      lastError = { message };

      const isTransient =
        message.includes('fetch failed') ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT');

      if (!isTransient) {
        return { data: null, error: lastError };
      }
    }

    // Log retry attempt
    if (attempt < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(
        {
          ...ctx,
          attempt: attempt + 1,
          maxRetries,
          delay,
          error: lastError?.message,
        },
        'Retrying Supabase query after transient error',
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { data: null, error: lastError };
}

/**
 * Processes scheduled publishes that are due.
 * This job should run every minute via cron.
 *
 * For platforms without native scheduling (TikTok, Instagram, Twitter),
 * we store the scheduled_at time and this job publishes when the time comes.
 *
 * @returns Statistics about the processing job
 */
export async function processScheduledPublishes(): Promise<ProcessScheduledResult> {
  const logger = await getLogger();
  const ctx = { name: 'scheduled-publish.job' };
  const client = getSupabaseServerAdminClient();
  const now = new Date();

  // Find scheduled publishes that are due (with retry for transient failures)
  const { data: duePublishes, error } = await queryWithRetry<
    ScheduledPublish[]
  >(
    async () => {
      const result = await client
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
      language,
      content_type,
      ai_generated,
      episodes(final_video_url, thumbnail_url, localized_videos, shorts_groups, project_id)
    `,
        )
        .eq('status', 'scheduled')
        .lte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(10);

      return {
        data: result.data as ScheduledPublish[] | null,
        error: result.error ? { message: result.error.message } : null,
      };
    },
    logger,
    ctx,
  );

  if (error) {
    const isNetworkError =
      error.message?.includes('fetch failed') ||
      error.message?.includes('ECONNRESET');
    logger.error(
      {
        ...ctx,
        error: error.message,
        errorType: isNetworkError ? 'transient_network' : 'query_error',
        retriesExhausted: true,
      },
      'Failed to query scheduled publishes after retries',
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
  console.log(
    `[ScheduledPublish] Processing ${duePublishes.length} due publishes`,
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
        throw new TokenRefusal(
          tokenResult.error ?? 'NO_ACCESS_TOKEN',
          publish.platform,
        );
      }

      // Get platform account ID
      const { data: connection, error: connError } = await client
        .from('platform_connections')
        .select(
          'platform_account_id, youtube_made_for_kids, youtube_category_id',
        )
        .eq('id', publish.platform_connection_id)
        .single();

      if (connError || !connection) {
        throw new Error(whyNoRow(connError, 'Platform connection not found'));
      }

      const episode = publish.episodes;
      if (!episode) {
        throw new Error('Episode not found');
      }

      // Resolve video URL based on language and content type
      const lang = publish.language || 'en';
      const isShort = publish.content_type === 'short';
      const localizedVideos = episode.localized_videos ?? {};
      const shortsGroups = episode.shorts_groups ?? [];

      // Get shortsGroupId from metadata
      const shortsGroupId = (publish.metadata as Record<string, unknown> | null)
        ?.shortsGroupId as string | undefined;

      // Log all available data for debugging
      const debugData = {
        publishId: publish.id,
        language: lang,
        contentType: publish.content_type,
        isShort,
        hasLocalizedVideos: Object.keys(localizedVideos).length > 0,
        localizedVideoLanguages: Object.keys(localizedVideos),
        shortsGroupCount: shortsGroups.length,
        hasFinalVideoUrl: !!episode.final_video_url,
        shortsGroupId,
      };
      console.log(
        `[ScheduledPublish] Resolving video URL:`,
        JSON.stringify(debugData),
      );
      logger.info(
        {
          ...publishCtx,
          ...debugData,
        },
        'Resolving video URL for scheduled publish',
      );

      // One resolver for every publish path (KB-123), with this path's precedence
      const resolved = resolveEpisodeVideo(episode, {
        language: lang,
        platform: publish.platform,
        short: isShort,
        shortsGroupId,
        ...SCHEDULED_JOB_PRECEDENCE,
      });
      const videoUrl = resolved?.url ?? null;

      logger.info(
        {
          ...publishCtx,
          isShort,
          resolvedFrom: resolved?.from ?? 'none',
        },
        'Video URL resolution',
      );

      if (!videoUrl) {
        logger.error(
          {
            ...publishCtx,
            language: lang,
            contentType: publish.content_type,
            availableLanguages: Object.keys(localizedVideos),
            shortsGroups: shortsGroups.map((g, i) => ({
              index: i,
              languages: g?.videos ? Object.keys(g.videos) : [],
            })),
          },
          'No video available for scheduled publish',
        );
        console.error(
          `[ScheduledPublish] ERROR: No video for language=${lang}, content_type=${publish.content_type}, availableLanguages=${Object.keys(localizedVideos).join(',')}`,
        );
        throw new Error(
          `No video available for language: ${lang}, content_type: ${publish.content_type}`,
        );
      }

      // Only a file of this episode's own project is sent (KB-123)
      const ownedVideoUrl = await ownedEpisodeVideo(
        videoUrl,
        { episodeId: publish.episode_id, projectId: episode.project_id },
        async (episodeId) => {
          const { data } = await client
            .from('episodes')
            .select('project_id')
            .eq('id', episodeId)
            .maybeSingle();

          return data?.project_id ?? null;
        },
      );

      if (!ownedVideoUrl) {
        throw new Error(EPISODE_VIDEO_PUBLISH_REFUSAL);
      }

      logger.info(
        { ...publishCtx, videoUrl: videoUrl.substring(0, 100) + '...' },
        'Video URL resolved successfully',
      );

      // Execute the platform upload
      const uploadResult = await uploadToPlatform(
        publish.platform as Platform,
        tokenResult.accessToken,
        connection,
        {
          videoUrl: videoUrl,
          title: publish.title ?? '',
          description: publish.description ?? '',
          tags: publish.tags ?? [],
          // KB-104: the row is writable by any project writer
          thumbnailUrl:
            ownedEpisodeThumbnail(publish.thumbnail_url, publish.episode_id) ??
            ownedEpisodeThumbnail(episode.thumbnail_url, publish.episode_id),
          platformSpecific: publish.metadata ?? {},
          aiGenerated: publish.ai_generated,
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

      // FILM-1710: never throws
      await recordUploadedFileDuration(
        () => client,
        { id: publish.id, platform: publish.platform },
        videoUrl,
      );

      results.published++;
      console.log(
        `[ScheduledPublish] SUCCESS: Published ${publish.id} to ${publish.platform}, url=${uploadResult.url}`,
      );
      logger.info(
        { ...publishCtx, url: uploadResult.url },
        'Scheduled publish completed',
      );
    } catch (err) {
      results.failed++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      // Update with failure
      await client
        .from('publishes')
        .update({
          status: 'failed',
          metadata: {
            ...(publish.metadata ?? {}),
            error: errorMessage,
            errorCode: tokenErrorCodeOf(err),
            errorStack: errorStack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
            failedAt: new Date().toISOString(),
          },
        })
        .eq('id', publish.id);

      console.error(
        `[ScheduledPublish] FAILED: ${publish.id} - ${errorMessage}`,
      );
      if (errorStack) {
        console.error(`[ScheduledPublish] Stack trace:\n${errorStack}`);
      }
      logger.error(
        {
          ...publishCtx,
          error: errorMessage,
          errorCode: tokenErrorCodeOf(err),
          stack: errorStack,
        },
        'Scheduled publish failed',
      );
    }

    // Small delay between publishes to avoid rate limiting
    await sleep(500);
  }

  console.log(
    `[ScheduledPublish] COMPLETE: ${results.published}/${results.processed} published, ${results.failed} failed`,
  );
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
  connection: {
    platform_account_id: string | null;
  } & YouTubeChannelDeclaration,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    thumbnailUrl?: string | null;
    platformSpecific: Record<string, unknown>;
    /** The publish's AI declaration, sent where the platform has a field (FILM-1731) */
    aiGenerated: boolean;
  },
): Promise<{ contentId: string; url: string }> {
  const accountId = connection.platform_account_id ?? '';

  switch (platform) {
    case 'youtube':
      return uploadToYouTube(
        accessToken,
        {
          ...options,
          privacy:
            (options.platformSpecific.privacy as
              | 'private'
              | 'unlisted'
              | 'public'
              | undefined) ?? 'private',
        },
        connection,
      );
    case 'tiktok':
      return uploadToTikTok(accessToken, options);
    case 'instagram':
      return uploadToInstagram(accessToken, accountId, options);
    case 'facebook':
      return uploadToFacebook(accessToken, accountId, options);
    case 'twitter':
      return uploadToTwitter(accessToken, options);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function uploadToTikTok(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    platformSpecific: Record<string, unknown>;
    aiGenerated: boolean;
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
    isAigc: options.aiGenerated,
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
    aiGenerated: boolean;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new InstagramProvider(accessToken, accountId);
  const result = await provider.uploadReel({
    videoUrl: options.videoUrl,
    caption: `${options.title}\n\n${options.description}`,
    shareToFeed: (options.platformSpecific.shareToFeed as boolean) ?? true,
    locationId: options.platformSpecific.locationId as string | undefined,
    aiGenerated: options.aiGenerated,
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
    aiGenerated: boolean;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new TwitterProvider(accessToken);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    text: options.title,
    madeWithAi: options.aiGenerated,
  });

  return { contentId: result.tweetId, url: result.tweetUrl ?? '' };
}

/**
 * Utility function for async sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
