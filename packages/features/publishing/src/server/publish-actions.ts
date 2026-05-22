'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { z } from 'zod';

import type { AggregatedTotals } from '@kit/clickhouse';
import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { DeleteJobMessage } from '../lib/job-types';
import {
  GetPublishStatusSchema,
  PublishToAllSchema,
  RetryPublishSchema,
} from '../lib/schemas/publish.schema';
import type { Platform, PublishResult } from '../lib/types';
import { validateContentUrl } from '../lib/url-validation';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { LinkedInProvider } from '../providers/linkedin';
import { TikTokProvider } from '../providers/tiktok';
import { TwitterProvider } from '../providers/twitter';
// Import providers
import { YouTubeProvider } from '../providers/youtube';
import { getAccessToken } from './connection-actions';

// Initialize SQS client
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
});
const PUBLISH_QUEUE_URL = process.env.PUBLISH_QUEUE_URL!;

/**
 * Replace localhost URLs with tunnel URL for external platform uploads.
 * Platforms like Instagram, Facebook, and TikTok cannot fetch from localhost.
 * Set TUNNEL_URL in .env.localprod (e.g., from ngrok or cloudflare tunnel).
 */
function getTunnelUrl(url: string): string {
  const tunnelUrl = process.env.TUNNEL_URL;

  if (!tunnelUrl) {
    // No tunnel configured, return original URL
    return url;
  }

  // Replace localhost URLs with tunnel URL
  const localhostPatterns = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://0.0.0.0:3000',
  ];

  for (const pattern of localhostPatterns) {
    if (url.startsWith(pattern)) {
      const newUrl = url.replace(pattern, tunnelUrl);
      console.log(`[Tunnel] Replaced ${pattern} with ${tunnelUrl}`);
      return newUrl;
    }
  }

  return url;
}

/**
 * Publish video to all selected platforms
 */
export const publishToAllAction = enhanceAction(
  async ({ episodeId, platforms }, _user) => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.publishToAll',
      episodeId,
      platformCount: platforms.length,
    };

    logger.info(ctx, 'Starting multi-platform publish');

    const client = getSupabaseServerClient();

    // Get episode video - fetch localized videos and shorts groups for multi-language support
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select(
        'final_video_url, thumbnail_url, project_id, localized_videos, shorts_groups, public_slug, title, number',
      )
      .eq('id', episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    // Support both legacy final_video_url and new localized_videos
    const localizedVideos =
      (episode.localized_videos as Record<string, string> | null) ?? {};
    const shortsGroups =
      (episode.shorts_groups as Array<{
        videos: Record<string, string>;
      }> | null) ?? [];
    const hasAnyShortsVideos = shortsGroups.some(
      (g) => Object.keys(g.videos || {}).length > 0,
    );
    const hasAnyVideos =
      !!episode.final_video_url ||
      Object.keys(localizedVideos).length > 0 ||
      hasAnyShortsVideos;

    if (!hasAnyVideos) {
      logger.error(ctx, 'Episode video not ready');
      throw new Error(
        'No videos available for publishing. Upload videos first.',
      );
    }

    // Publish to all platforms in parallel
    const results = await Promise.allSettled(
      platforms.map(async (platform) => {
        const platformCtx = { ...ctx, platform: platform.platform };

        try {
          // Validate token
          const tokenResult = await getAccessToken(platform.connectionId);
          if (tokenResult.error || !tokenResult.accessToken) {
            throw new Error(tokenResult.error ?? 'Failed to get access token');
          }
          const accessToken = tokenResult.accessToken;

          // Get connection details
          const { data: connection, error: connError } = await client
            .from('platform_connections')
            .select('platform_account_id, platform_account_name')
            .eq('id', platform.connectionId)
            .single();

          if (connError || !connection) {
            throw new Error('Platform connection not found');
          }

          // Get connection language as fallback (if explicit language not provided)
          // Using separate query to handle both typed and untyped scenarios
          let connectionLanguage = 'en';
          try {
            const { data: langData } = await client
              .from('platform_connections')
              .select('language')
              .eq('id', platform.connectionId)
              .single();
            // Cast through unknown to handle untyped column
            const langRecord = langData as unknown as Record<
              string,
              unknown
            > | null;
            if (langRecord && typeof langRecord.language === 'string') {
              connectionLanguage = langRecord.language;
            }
          } catch {
            // Column may not exist yet, use default
          }

          // Use explicit language from request, or fall back to connection language
          const publishLanguage = platform.language || connectionLanguage;

          // Create publish record
          // Determine if this is a server-side scheduled publish
          // ALL platforms now use server-side scheduling (cron job publishes at scheduled time)
          const isScheduled = !!platform.scheduledAt;
          const useServerScheduling = isScheduled;

          const { data: publish, error: publishError } = await client
            .from('publishes')
            .insert({
              episode_id: episodeId,
              platform_connection_id: platform.connectionId,
              platform: platform.platform,
              // Use contentType from input (full or short) - not hardcoded!
              content_type: platform.contentType || 'full',
              // For shorts: store the group ID so cron can find the right video
              // Note: We cannot use source_shot_id as it expects a UUID, but our group IDs are strings
              title: platform.title,
              description: platform.description,
              tags: platform.tags,
              thumbnail_url: platform.thumbnailUrl ?? episode.thumbnail_url,
              status: useServerScheduling ? 'scheduled' : 'publishing',
              scheduled_at: platform.scheduledAt ?? null,
              metadata: {
                ...JSON.parse(JSON.stringify(platform.platformSpecific)),
                shortsGroupId: platform.shortsGroupId,
                createdBy: _user.id,
              },
              // Language from explicit request or connection fallback
              language: publishLanguage,
            })
            .select()
            .single();

          if (publishError || !publish) {
            throw new Error('Failed to create publish record');
          }

          // For server-side scheduling, don't upload now - the cron job will handle it
          if (useServerScheduling) {
            logger.info(
              {
                ...platformCtx,
                publishId: publish.id,
                scheduledAt: platform.scheduledAt,
              },
              'Created scheduled publish record - will be processed by cron job',
            );

            return {
              platform: platform.platform,
              status: 'scheduled' as const,
              publishId: publish.id,
            };
          }

          logger.info(
            { ...platformCtx, publishId: publish.id },
            'Created publish record, starting upload',
          );

          // Determine which video URL to use based on contentType from client
          // Client explicitly tells us if this is a full video or shorts publish
          const isShortsPreferred = platform.contentType === 'short';

          let videoUrl: string | null = null;
          const lang = publishLanguage;

          // Get shorts video URL from groups (first group that has this language)
          const getShortsVideoUrl = (language: string): string | null => {
            for (const group of shortsGroups) {
              if (group.videos && group.videos[language]) {
                return group.videos[language];
              }
            }
            return null;
          };
          const shortsVideoUrl = getShortsVideoUrl(lang);

          if (isShortsPreferred) {
            // Try shorts first, fall back to full video
            videoUrl =
              shortsVideoUrl ??
              localizedVideos[lang] ??
              episode.final_video_url ??
              null;
          } else {
            // Try full video first, fall back to shorts
            videoUrl =
              localizedVideos[lang] ??
              shortsVideoUrl ??
              episode.final_video_url ??
              null;
          }

          if (!videoUrl) {
            throw new Error(`No video available for language: ${lang}`);
          }

          // Update content_type based on what we're actually publishing
          const actualContentType =
            shortsVideoUrl && isShortsPreferred ? 'short' : 'full';
          await client
            .from('publishes')
            .update({ content_type: actualContentType })
            .eq('id', publish.id);

          // Apply tunnel URL for external platforms (Instagram, Facebook, TikTok)
          // YouTube uses direct byte upload so doesn't need tunneling
          const needsTunnel = ['instagram', 'facebook', 'tiktok'].includes(
            platform.platform,
          );
          const finalVideoUrl = needsTunnel ? getTunnelUrl(videoUrl) : videoUrl;

          // Validate URLs for SSRF protection (skip in development with tunnel)
          const safeThumbnailUrl = validateContentUrl(
            platform.thumbnailUrl ?? episode.thumbnail_url,
          );

          // Upload to platform (immediately or with native scheduling)
          const uploadResult = await uploadToPlatform(
            platform.platform,
            accessToken,
            connection.platform_account_id ?? '',
            {
              videoUrl: finalVideoUrl,
              title: platform.title,
              description: platform.description,
              tags: platform.tags,
              thumbnailUrl: safeThumbnailUrl,
              scheduledAt: platform.scheduledAt
                ? new Date(platform.scheduledAt)
                : undefined,
              isShort: isShortsPreferred,
              platformSpecific: platform.platformSpecific,
            },
          );

          // Update publish record with success
          await client
            .from('publishes')
            .update({
              status: 'published',
              platform_content_id: uploadResult.contentId,
              platform_url: uploadResult.url,
              published_at: new Date().toISOString(),
            })
            .eq('id', publish.id);

          // Auto-generate and set public_slug on episode if not already set
          // This enables the episode to appear on public share pages
          if (!episode.public_slug) {
            const slugBase = episode.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '')
              .slice(0, 40);
            const publicSlug = `${slugBase}-ep${episode.number}`;

            await client
              .from('episodes')
              .update({ public_slug: publicSlug })
              .eq('id', episodeId);

            logger.info(
              { ...platformCtx, publicSlug },
              'Auto-generated public_slug for published episode',
            );
          }

          logger.info(
            { ...platformCtx, publishId: publish.id, url: uploadResult.url },
            'Publish completed successfully',
          );

          return {
            platform: platform.platform,
            status: 'completed' as const,
            platformContentId: uploadResult.contentId,
            platformUrl: uploadResult.url,
            publishId: publish.id,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          logger.error(
            { ...platformCtx, error: errorMessage },
            'Publish failed',
          );

          // Try to update publish record with failure
          try {
            await client
              .from('publishes')
              .update({
                status: 'failed',
                metadata: JSON.parse(
                  JSON.stringify({
                    ...platform.platformSpecific,
                    error: errorMessage,
                  }),
                ),
              })
              .eq('episode_id', episodeId)
              .eq('platform_connection_id', platform.connectionId)
              .eq('status', 'publishing');
          } catch {
            // Ignore update errors
          }

          throw error;
        }
      }),
    );

    // Transform results
    const publishResults: PublishResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        platform: platforms[index]!.platform as Platform,
        status: 'failed' as const,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : 'Unknown error',
      };
    });

    // Revalidate episode page - use 'page' type for dynamic routes
    revalidatePath(
      '/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish',
      'page',
    );

    logger.info(
      {
        ...ctx,
        successCount: publishResults.filter((r) => r.status === 'completed')
          .length,
        failCount: publishResults.filter((r) => r.status === 'failed').length,
      },
      'Multi-platform publish completed',
    );

    return publishResults;
  },
  {
    schema: PublishToAllSchema,
    auth: true,
  },
);

/**
 * Get publish status for an episode
 */
export const getPublishStatusAction = enhanceAction(
  async ({ episodeId }, _user) => {
    const client = getSupabaseServerClient();

    const { data: publishes, error } = await client
      .from('publishes')
      .select(
        'id, platform, status, platform_content_id, platform_url, metadata',
      )
      .eq('episode_id', episodeId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch publish status: ${error.message}`);
    }

    // Group by platform and return latest status
    const statusByPlatform: Record<string, PublishResult> = {};

    for (const publish of publishes ?? []) {
      // Only keep the latest status for each platform
      if (!statusByPlatform[publish.platform]) {
        const metadata = publish.metadata as Record<string, unknown> | null;
        statusByPlatform[publish.platform] = {
          platform: publish.platform as Platform,
          status: mapDbStatus(publish.status),
          platformContentId: publish.platform_content_id ?? undefined,
          platformUrl: publish.platform_url ?? undefined,
          error: metadata?.error as string | undefined,
          publishId: publish.id,
        };
      }
    }

    return statusByPlatform;
  },
  {
    schema: GetPublishStatusSchema,
    auth: true,
  },
);

/**
 * Retry a failed publish
 */
export const retryPublishAction = enhanceAction(
  async ({ publishId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.retry', publishId };

    logger.info(ctx, 'Retrying failed publish');

    const client = getSupabaseServerClient();

    // Get publish record
    const { data: publish, error: publishError } = await client
      .from('publishes')
      .select(
        `
        id, episode_id, platform_connection_id, platform, content_type, status,
        title, description, tags, thumbnail_url, platform_content_id, platform_url,
        scheduled_at, published_at, language, metadata, created_at,
        episodes(final_video_url, thumbnail_url)
      `,
      )
      .eq('id', publishId)
      .single();

    if (publishError || !publish) {
      throw new Error('Publish record not found');
    }

    if (publish.status !== 'failed') {
      throw new Error('Can only retry failed publishes');
    }

    const episode = publish.episodes as {
      final_video_url: string | null;
      thumbnail_url: string | null;
    } | null;

    if (!episode?.final_video_url) {
      throw new Error('Episode video not available');
    }

    // Get access token
    if (!publish.platform_connection_id) {
      throw new Error('Platform connection ID is missing');
    }
    const tokenResult = await getAccessToken(publish.platform_connection_id);
    if (tokenResult.error || !tokenResult.accessToken) {
      throw new Error(tokenResult.error ?? 'Failed to get access token');
    }
    const accessToken = tokenResult.accessToken;

    // Get connection
    const { data: connection } = await client
      .from('platform_connections')
      .select('platform_account_id')
      .eq('id', publish.platform_connection_id)
      .single();

    if (!connection) {
      throw new Error('Platform connection not found');
    }

    // Update status to publishing
    await client
      .from('publishes')
      .update({ status: 'publishing' })
      .eq('id', publishId);

    try {
      const uploadResult = await uploadToPlatform(
        publish.platform as Platform,
        accessToken,
        connection.platform_account_id ?? '',
        {
          videoUrl: episode.final_video_url,
          title: publish.title ?? '',
          description: publish.description ?? '',
          tags: publish.tags ?? [],
          thumbnailUrl: publish.thumbnail_url ?? episode.thumbnail_url,
          platformSpecific: (publish.metadata ?? {}) as Record<string, unknown>,
        },
      );

      await client
        .from('publishes')
        .update({
          status: 'published',
          platform_content_id: uploadResult.contentId,
          platform_url: uploadResult.url,
          published_at: new Date().toISOString(),
        })
        .eq('id', publishId);

      return {
        platform: publish.platform as Platform,
        status: 'completed' as const,
        platformContentId: uploadResult.contentId,
        platformUrl: uploadResult.url,
        publishId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      await client
        .from('publishes')
        .update({
          status: 'failed',
          metadata: {
            ...(publish.metadata as object),
            error: errorMessage,
            retryCount:
              ((publish.metadata as Record<string, number>)?.retryCount ?? 0) +
              1,
          },
        })
        .eq('id', publishId);

      throw error;
    }
  },
  {
    schema: RetryPublishSchema,
    auth: true,
  },
);

/**
 * Map database status to PublishResult status
 */
function mapDbStatus(
  dbStatus: string,
): 'pending' | 'publishing' | 'completed' | 'failed' | 'scheduled' {
  switch (dbStatus) {
    case 'draft':
    case 'pending':
      return 'pending';
    case 'publishing':
      return 'publishing';
    case 'published':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'scheduled':
      return 'scheduled';
    default:
      return 'pending';
  }
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
    scheduledAt?: Date;
    isShort?: boolean;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  switch (platform) {
    case 'youtube':
      return uploadToYouTube(accessToken, {
        ...options,
        isShort: options.isShort ?? false,
      });
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
    scheduledAt?: Date;
    isShort?: boolean;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new YouTubeProvider(accessToken);

  // For YouTube Shorts, add #Shorts hashtag to title and description
  let title = options.title;
  let description = options.description;
  if (options.isShort) {
    if (!title.toLowerCase().includes('#shorts')) {
      title = `${title} #Shorts`;
    }
    if (!description.toLowerCase().includes('#shorts')) {
      description = `${description}\n\n#Shorts`;
    }
  }

  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    title,
    description,
    tags: options.tags,
    categoryId: (options.platformSpecific.categoryId as string) ?? '22',
    // Always public - scheduling is handled server-side by cron job
    privacy: 'public',
    madeForKids: (options.platformSpecific.madeForKids as boolean) ?? false,
    thumbnailPath: options.thumbnailUrl ?? undefined,
    playlistIds: options.platformSpecific.playlistIds as string[] | undefined,
    // publishAt removed - cron job handles scheduling
  });

  return { contentId: result.videoId, url: result.videoUrl ?? '' };
}

async function uploadToTikTok(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
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
    scheduledAt?: Date;
    platformSpecific: Record<string, unknown>;
  },
): Promise<{ contentId: string; url: string }> {
  const provider = new FacebookProvider(accessToken, pageId);
  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    title: options.title,
    description: options.description,
    isReel: (options.platformSpecific.isReel as boolean) ?? false,
    published: !options.scheduledAt,
    scheduledPublishTime: options.scheduledAt,
  });

  // Fetch the video URL from Facebook after upload
  let videoUrl = '';
  try {
    const status = await provider.getVideoStatus(result.videoId);
    videoUrl =
      status.videoUrl ?? `https://www.facebook.com/watch/?v=${result.videoId}`;
  } catch {
    // Fallback to constructed URL if status fetch fails
    videoUrl = `https://www.facebook.com/watch/?v=${result.videoId}`;
  }

  return { contentId: result.videoId, url: videoUrl };
}

async function uploadToTwitter(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
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
 * Get all publishes for an episode with analytics
 */
export const getEpisodePublishesAction = enhanceAction(
  async ({ episodeId }, _user) => {
    const client = getSupabaseServerClient();

    const { data: publishes, error } = await client
      .from('publishes')
      .select(
        `
        id,
        platform,
        content_type,
        status,
        title,
        description,
        platform_content_id,
        platform_url,
        language,
        scheduled_at,
        published_at,
        created_at,
        metadata,
        platform_connections (
          platform_account_name
        )
      `,
      )
      .eq('episode_id', episodeId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch episode publishes: ${error.message}`);
    }

    // Fetch analytics from ClickHouse for all publish IDs
    const publishIds = (publishes ?? []).map((p) => p.id);
    let analyticsMap = new Map<string, AggregatedTotals>();

    if (publishIds.length > 0) {
      try {
        analyticsMap = await queryTotalsByVideoIds(publishIds);
      } catch (err) {
        getLogger().then((logger) =>
          logger.warn(
            { err },
            'ClickHouse unavailable, returning publishes without analytics',
          ),
        );
      }
    }

    return (publishes ?? []).map((p) => {
      const chTotals = analyticsMap.get(p.id);

      return {
        id: p.id,
        platform: p.platform as Platform,
        contentType: p.content_type as 'full' | 'short' | 'teaser' | 'trailer',
        status: p.status as
          | 'draft'
          | 'scheduled'
          | 'publishing'
          | 'published'
          | 'failed',
        title: p.title,
        platformContentId: p.platform_content_id,
        platformUrl: p.platform_url,
        language: ((p as Record<string, unknown>).language as string) ?? 'en',
        channelName:
          (p.platform_connections as { platform_account_name: string } | null)
            ?.platform_account_name ?? 'Unknown',
        scheduledAt: p.scheduled_at,
        publishedAt: p.published_at,
        createdAt: p.created_at,
        analytics: chTotals
          ? {
              views: chTotals.views,
              likes: chTotals.likes,
              comments: chTotals.comments,
              shares: chTotals.shares,
              watchTimeSeconds: chTotals.watch_time_seconds,
            }
          : null,
        error: (p.metadata as { error?: string } | null)?.error,
      };
    });
  },
  {
    schema: GetPublishStatusSchema,
    auth: true,
  },
);

/**
 * Deletes all publish records for an episode AND removes content from platforms
 * Used for cleanup/testing purposes.
 * Now uses async worker to avoid timeouts.
 */
export const deleteEpisodePublishesAction = enhanceAction(
  async ({ episodeId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.deleteEpisodePublishes', episodeId };

    logger.info(ctx, 'Deleting all publish records for episode (async)');

    const client = getSupabaseServerClient();

    // Fetch all publishes with platform details for deletion
    const { data: publishes } = await client
      .from('publishes')
      .select('id, platform, platform_content_id, platform_connection_id')
      .eq('episode_id', episodeId);

    if (!publishes || publishes.length === 0) {
      logger.info(ctx, 'No publish records to delete');
      return { success: true, deletedCount: 0, platformErrors: [] };
    }

    if (!PUBLISH_QUEUE_URL) {
      logger.error(ctx, 'PUBLISH_QUEUE_URL not configured');
      throw new Error('System configuration error: Queue URL missing');
    }

    // Mark all as 'deleting' in database
    await client
      .from('publishes')
      .update({ status: 'deleting' })
      .eq('episode_id', episodeId);

    // Enqueue delete jobs
    const messages = publishes.map((pub) => {
      const message: DeleteJobMessage = {
        type: 'delete',
        publishId: pub.id,
        userId: _user.id,
        platformConnectionId: pub.platform_connection_id!,
        episodeId,
        platform: pub.platform as DeleteJobMessage['platform'],
        platformContentId: pub.platform_content_id || '',
      };
      return message;
    });

    // Send to SQS in batches (parallel)
    await Promise.all(
      messages.map((msg) =>
        sqsClient.send(
          new SendMessageCommand({
            QueueUrl: PUBLISH_QUEUE_URL,
            MessageBody: JSON.stringify(msg),
          }),
        ),
      ),
    );

    // Analytics are stored in ClickHouse — no Supabase cleanup needed

    logger.info(
      { ...ctx, count: publishes.length },
      'Enqueued delete jobs for publish records',
    );

    return {
      success: true,
      deletedCount: publishes.length,
      platformErrors: [],
    };
  },
  {
    schema: GetPublishStatusSchema,
    auth: true,
  },
);

/**
 * Unpublish a single publish record - deletes from platform AND database
 * Now uses async worker to avoid timeouts.
 */
export const unpublishAction = enhanceAction(
  async ({ publishId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.unpublish', publishId };

    logger.info(ctx, 'Unpublishing content from platform (async)');

    const client = getSupabaseServerClient();

    // Get the publish record with connection info
    const { data: publish, error: fetchError } = await client
      .from('publishes')
      .select(
        `
        id, episode_id, platform_connection_id, platform, platform_content_id
      `,
      )
      .eq('id', publishId)
      .single();

    if (fetchError || !publish) {
      logger.error({ ...ctx, error: fetchError }, 'Publish record not found');
      throw new Error('Publish record not found');
    }

    if (!PUBLISH_QUEUE_URL) {
      logger.error(ctx, 'PUBLISH_QUEUE_URL not configured');
      throw new Error('System configuration error: Queue URL missing');
    }

    // Mark as deleting
    await client
      .from('publishes')
      .update({ status: 'deleting' })
      .eq('id', publishId);

    // Enqueue delete job
    const message: DeleteJobMessage = {
      type: 'delete',
      publishId: publish.id,
      userId: _user.id,
      platformConnectionId: publish.platform_connection_id!,
      episodeId: publish.episode_id!,
      platform: publish.platform as DeleteJobMessage['platform'],
      platformContentId: publish.platform_content_id || '',
    };

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: PUBLISH_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );

    logger.info(ctx, 'Unpublish job enqueued');

    return { success: true };
  },
  {
    schema: z.object({ publishId: z.string().uuid() }),
    auth: true,
  },
);
