'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GetPublishStatusSchema,
  PublishToAllSchema,
  RetryPublishSchema,
} from '../lib/schemas/publish.schema';
import type { Platform, PublishResult } from '../lib/types';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { LinkedInProvider } from '../providers/linkedin';
import { TikTokProvider } from '../providers/tiktok';
import { TwitterProvider } from '../providers/twitter';
// Import providers
import { YouTubeProvider } from '../providers/youtube';
import { getAccessToken } from './connection-actions';

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

    // Get episode video
    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('final_video_url, thumbnail_url, project_id')
      .eq('id', episodeId)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error('Episode not found');
    }

    if (!episode.final_video_url) {
      logger.error(ctx, 'Episode video not ready');
      throw new Error('Episode video not ready for publishing');
    }

    const finalVideoUrl = episode.final_video_url;

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

          // Create publish record
          // Determine if this is a server-side scheduled publish
          // YouTube and Facebook have native scheduling, others don't
          const hasNativeScheduling =
            platform.platform === 'youtube' || platform.platform === 'facebook';
          const isScheduled = !!platform.scheduledAt;
          const useServerScheduling = isScheduled && !hasNativeScheduling;

          const { data: publish, error: publishError } = await client
            .from('publishes')
            .insert({
              episode_id: episodeId,
              platform_connection_id: platform.connectionId,
              platform: platform.platform,
              content_type: 'full',
              title: platform.title,
              description: platform.description,
              tags: platform.tags,
              thumbnail_url: platform.thumbnailUrl ?? episode.thumbnail_url,
              status: useServerScheduling ? 'scheduled' : 'publishing',
              scheduled_at: platform.scheduledAt ?? null,
              metadata: JSON.parse(JSON.stringify(platform.platformSpecific)),
            })
            .select()
            .single();

          if (publishError || !publish) {
            throw new Error('Failed to create publish record');
          }

          // For server-side scheduling, don't upload now - the cron job will handle it
          if (useServerScheduling) {
            logger.info(
              { ...platformCtx, publishId: publish.id, scheduledAt: platform.scheduledAt },
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
              thumbnailUrl: platform.thumbnailUrl ?? episode.thumbnail_url,
              scheduledAt: platform.scheduledAt
                ? new Date(platform.scheduledAt)
                : undefined,
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

    // Revalidate episode page
    revalidatePath(`/home/[account]/studio/[projectId]/episodes/${episodeId}`);

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
      .select('*, episodes(final_video_url, thumbnail_url)')
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
    scheduledAt?: Date;
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
    playlistIds: options.platformSpecific.playlistIds as string[] | undefined,
    publishAt: options.scheduledAt,
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

  return { contentId: result.videoId, url: result.videoUrl ?? '' };
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
