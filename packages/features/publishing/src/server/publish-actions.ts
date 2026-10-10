'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { z } from 'zod';

import type { AggregatedTotals } from '@kit/clickhouse';
import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import {
  awsClientOptions,
  holdsXUploadScope,
  queueUrlFromEnv,
  xUploadScopeRefusal,
  xVideoRefusal,
} from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  PUBLISH_NOW_PRECEDENCE,
  resolveEpisodeVideo,
} from '../lib/episode-video';
import type { DeleteJobMessage } from '../lib/job-types';
import { readMp4Facts } from '../lib/mp4-facts';
import {
  EPISODE_VIDEO_PUBLISH_REFUSAL,
  type ProjectOfEpisode,
  ownedEpisodeVideo,
} from '../lib/owned-episode-video';
import { ownedEpisodeThumbnail } from '../lib/owned-thumbnail';
import { PLATFORM_NAMES, isOfferedPlatform } from '../lib/platforms';
import {
  GetPublishStatusSchema,
  PublishToAllSchema,
  RetryPublishSchema,
} from '../lib/schemas/publish.schema';
import { groupTakesPlatform } from '../lib/shorts-targets';
import { TAKEDOWN_REFUSAL, canTakeDown, projectRoleOf } from '../lib/takedown';
import {
  TokenRefusal,
  isTokenErrorCode,
  readableTokenError,
  tokenErrorCodeOf,
} from '../lib/token-errors';
import { tweetLength } from '../lib/tweet-length';
import type { Platform, PublishResult } from '../lib/types';
import { recordUploadedFileDuration } from '../lib/uploaded-file-duration';
import {
  type YouTubeChannelDeclaration,
  type YouTubeDeclaration,
  YouTubeDeclarationMissing,
  resolveYouTubeDeclaration,
} from '../lib/youtube-declaration';
import { FacebookProvider } from '../providers/facebook';
import { InstagramProvider } from '../providers/instagram';
import { TikTokProvider } from '../providers/tiktok';
import { TwitterProvider } from '../providers/twitter';
import { TWITTER_CONSTRAINTS } from '../providers/twitter/types';
import { assertConnectionOfAccount } from './connection-account';
import { getAccessToken } from './connection-tokens';
import { assertConnectionOfProject } from './project-channels';
import { uploadToYouTube } from './youtube-upload';

// Initialize SQS client
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...awsClientOptions('sqs'),
});
const PUBLISH_QUEUE_URL = queueUrlFromEnv(process.env.PUBLISH_QUEUE_URL);

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

type PublishPlatformInput = z.infer<
  typeof PublishToAllSchema
>['platforms'][number];

/** The project of an episode, read as the caller: RLS decides what is seen (KB-123) */
function projectOfEpisodeVia(
  client: SupabaseClient<Database>,
): ProjectOfEpisode {
  return async (episodeId) => {
    const { data } = await client
      .from('episodes')
      .select('project_id')
      .eq('id', episodeId)
      .maybeSingle();

    return data?.project_id ?? null;
  };
}

function refusalFor(channelNames: string[]) {
  const names = channelNames.map((name) => `“${name}”`).join(', ');

  return `Choose whether ${names} is made for kids, and its category, before publishing to YouTube. You can set this in Settings → Platforms.`;
}

/**
 * KB-30. The audience and category each YouTube upload will declare, by index
 * into `platforms` — from the request, else the channel's own answer. Refuses
 * the whole request, naming every undeclared channel, before anything is
 * written: there is no value this falls back to.
 */
async function declareYouTubeUploads(platforms: PublishPlatformInput[]) {
  const declared = new Map<number, YouTubeDeclaration>();
  const connectionIds = [
    ...new Set(
      platforms
        .filter((platform) => platform.platform === 'youtube')
        .map((platform) => platform.connectionId),
    ),
  ];

  if (connectionIds.length === 0) return declared;

  const { data: channels, error } = await getSupabaseServerClient()
    .from('platform_connections')
    .select(
      'id, platform_account_name, youtube_made_for_kids, youtube_category_id',
    )
    .in('id', connectionIds);

  if (error) {
    throw new Error('Could not read the YouTube channels being published to');
  }

  const undeclared = new Set<string>();

  platforms.forEach((platform, index) => {
    if (platform.platform !== 'youtube') return;

    const channel =
      channels?.find((row) => row.id === platform.connectionId) ?? null;

    try {
      declared.set(
        index,
        resolveYouTubeDeclaration(platform.platformSpecific, channel),
      );
    } catch (resolveError) {
      if (!(resolveError instanceof YouTubeDeclarationMissing)) {
        throw resolveError;
      }
      undeclared.add(channel?.platform_account_name ?? 'this YouTube channel');
    }
  });

  if (undeclared.size > 0) {
    throw new ActionRefusal(refusalFor([...undeclared]));
  }

  return declared;
}

/**
 * FILM-1729. Refuses the whole request, before anything is written, when X
 * would refuse it: an X account that cannot upload video, or a video outside
 * X's limits (owner, 2026-10-01: refused on the screen, not found in the
 * worker). Each X video is the one the upload below would send, read from
 * its own MP4 header.
 */
async function assertXWillAccept(
  platforms: PublishPlatformInput[],
  episode: Parameters<typeof resolveEpisodeVideo>[0] & { project_id: string },
  episodeId: string,
) {
  const toX = platforms.filter((platform) => platform.platform === 'twitter');

  if (toX.length === 0) return;

  const connections = await assertXUploadScope(toX);

  for (const platform of toX) {
    // The title is the post's text, measured as X measures it (FILM-714)
    const postLength = tweetLength(platform.title);

    if (postLength > TWITTER_CONSTRAINTS.maxTweetLength) {
      throw new ActionRefusal(
        `X can't take this post: its title is ${postLength} characters, and an X post takes at most ${TWITTER_CONSTRAINTS.maxTweetLength}. Shorten the title for X.`,
      );
    }

    const language =
      platform.language ??
      connections.find((row) => row.id === platform.connectionId)?.language;
    const short = platform.contentType === 'short';
    const resolved = resolveEpisodeVideo(episode, {
      language: language ?? 'en',
      platform: platform.platform,
      short,
      shortsGroupId: short ? platform.shortsGroupId : null,
      ...PUBLISH_NOW_PRECEDENCE,
    });
    const videoUrl =
      resolved &&
      (await ownedEpisodeVideo(
        resolved.url,
        { episodeId, projectId: episode.project_id },
        projectOfEpisodeVia(getSupabaseServerClient()),
      ));

    // The upload refuses these itself, with its own words.
    if (!videoUrl) continue;

    const refusal = xVideoRefusal(await readMp4Facts(videoUrl));

    if (refusal) throw new ActionRefusal(refusal);
  }
}

/** Refuses every X account that cannot upload video; returns the accounts. */
async function assertXUploadScope(platforms: PublishPlatformInput[]) {
  const connectionIds = [
    ...new Set(
      platforms
        .filter((platform) => platform.platform === 'twitter')
        .map((platform) => platform.connectionId),
    ),
  ];

  const { data: connections, error } = await getSupabaseServerClient()
    .from('platform_connections')
    .select('id, platform_account_name, scopes, language')
    .in('id', connectionIds);

  if (error) {
    throw new Error('Could not read the X accounts being published to');
  }

  const lacking = connectionIds
    .map((id) => connections?.find((row) => row.id === id))
    .filter((row) => !row || !holdsXUploadScope(row.scopes))
    .map((row) => row?.platform_account_name ?? 'this X account');

  if (lacking.length > 0) {
    throw new ActionRefusal(xUploadScopeRefusal(lacking));
  }

  return connections ?? [];
}

/**
 * Publish video to all selected platforms
 */
const publishToAllHandler = enhanceAction(
  async ({ episodeId, platforms, aiGenerated = false }, _user) => {
    const logger = await getLogger();
    const ctx = {
      name: 'publishing.publishToAll',
      episodeId,
      platformCount: platforms.length,
    };

    logger.info(ctx, 'Starting multi-platform publish');

    const client = getSupabaseServerClient();

    // Get episode video - fetch localized videos and shorts groups for multi-language support
    const episode = requireRow(
      await client
        .from('episodes')
        .select(
          'final_video_url, thumbnail_url, project_id, localized_videos, shorts_groups, public_slug, title, number, project:projects!inner(account_id)',
        )
        .eq('id', episodeId)
        .single(),
      'Episode not found',
    );

    // Support both legacy final_video_url and new localized_videos
    const localizedVideos =
      (episode.localized_videos as Record<string, string> | null) ?? {};
    const shortsGroups =
      (episode.shorts_groups as Array<{
        id: string;
        name?: string;
        platforms?: string[];
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
      throw new ActionRefusal(
        'No videos available for publishing. Upload videos first.',
      );
    }

    // KB-109: every channel is one of the episode's account, asked before
    // any token is decrypted or refreshed
    const connectionIds = new Set(
      platforms.map((platform) => platform.connectionId),
    );
    for (const connectionId of connectionIds) {
      await assertConnectionOfAccount(
        client,
        connectionId,
        episode.project.account_id,
      );
    }

    // An episode publishes only to its project's channels
    await assertConnectionOfProject(client, connectionIds, episode.project_id);

    // A Shorts group goes only to the platforms it names
    for (const platform of platforms) {
      if (platform.contentType !== 'short' || !platform.shortsGroupId) continue;

      const group = shortsGroups.find((g) => g.id === platform.shortsGroupId);
      if (group && !groupTakesPlatform(group, platform.platform)) {
        const name = PLATFORM_NAMES[platform.platform];
        throw new ActionRefusal(
          `The Shorts group "${group.name || 'Shorts'}" isn't set to go to ${name}. Tick ${name} on the group first.`,
        );
      }
    }

    // KB-104: a thumbnail is downloaded and sent to the channel, so only one
    // of this episode's own uploads may be named. Checked before anything is
    // written, so a refused publish leaves no row behind.
    if (
      platforms.some(
        (platform) =>
          platform.thumbnailUrl &&
          !ownedEpisodeThumbnail(platform.thumbnailUrl, episodeId),
      )
    ) {
      throw new ActionRefusal(
        "That thumbnail isn't one of this episode's uploads. Choose one of the episode's thumbnails.",
      );
    }

    // The episode's own thumbnail, when it is one of its uploads
    const episodeThumbnail = ownedEpisodeThumbnail(
      episode.thumbnail_url,
      episodeId,
    );

    // KB-30: every YouTube upload declares an audience and a category the
    // creator chose. Resolve them all before anything is written, so a
    // publish nobody declared leaves no row behind.
    const declared = await declareYouTubeUploads(platforms);

    // FILM-1729: nothing goes to X that X would refuse
    await assertXWillAccept(platforms, episode, episodeId);

    // Publish to all platforms in parallel
    const results = await Promise.allSettled(
      platforms.map(async (platform, index) => {
        const platformSpecific: Record<string, unknown> = {
          ...platform.platformSpecific,
          ...declared.get(index),
        };
        const platformCtx = { ...ctx, platform: platform.platform };

        try {
          // Validate token
          const tokenResult = await getAccessToken(platform.connectionId);
          if (tokenResult.error !== undefined) {
            throw new TokenRefusal(tokenResult.error, platform.platform);
          }
          const accessToken = tokenResult.accessToken;

          // Get connection details
          const connection = requireRow(
            await client
              .from('platform_connections')
              .select('platform_account_id, platform_account_name, language')
              .eq('id', platform.connectionId)
              .single(),
            'Platform connection not found',
          );

          // The language of the asset this publish uploads: the one the
          // request names, else the channel's target, which is what selects
          // the asset below. Read with the connection rather than in a
          // second query that fell back to 'en' when it failed — that
          // recorded English for a publish nobody had called English, which
          // is the defect FILM-1702 removes. The column is NOT NULL.
          const publishLanguage = platform.language ?? connection.language;

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
              thumbnail_url: platform.thumbnailUrl ?? episodeThumbnail,
              status: useServerScheduling ? 'scheduled' : 'publishing',
              scheduled_at: platform.scheduledAt ?? null,
              metadata: {
                ...JSON.parse(JSON.stringify(platformSpecific)),
                shortsGroupId: platform.shortsGroupId,
                createdBy: _user.id,
              },
              // Language from explicit request or connection fallback
              language: publishLanguage,
              // FILM-1731: what every later attempt sends as the AI label
              ai_generated: aiGenerated,
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

          const lang = publishLanguage;

          // One resolver for every publish path (KB-123). A short uses the
          // group it names, as the scheduled paths do (KB-133).
          const resolved = resolveEpisodeVideo(episode, {
            language: lang,
            platform: platform.platform,
            short: isShortsPreferred,
            shortsGroupId: isShortsPreferred ? platform.shortsGroupId : null,
            ...PUBLISH_NOW_PRECEDENCE,
          });

          if (!resolved) {
            throw new ActionRefusal(`No video available for language: ${lang}`);
          }

          // Only a file of this episode's own project is sent (KB-123)
          const videoUrl = await ownedEpisodeVideo(
            resolved.url,
            { episodeId, projectId: episode.project_id },
            projectOfEpisodeVia(client),
          );

          if (!videoUrl) {
            throw new ActionRefusal(EPISODE_VIDEO_PUBLISH_REFUSAL);
          }

          // Update content_type based on what we're actually publishing
          const actualContentType =
            resolved.from === 'short' && isShortsPreferred ? 'short' : 'full';
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

          const thumbnailUrl = platform.thumbnailUrl ?? episodeThumbnail;

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
              thumbnailUrl,
              scheduledAt: platform.scheduledAt
                ? new Date(platform.scheduledAt)
                : undefined,
              isShort: isShortsPreferred,
              platformSpecific,
              aiGenerated,
            },
            null,
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

          // FILM-1710: the length of the file just sent, for a platform that
          // never reports one back
          await recordUploadedFileDuration(
            getSupabaseServerAdminClient,
            { id: publish.id, platform: platform.platform },
            videoUrl,
          );

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
          const errorCode = tokenErrorCodeOf(error);

          logger.error(
            { ...platformCtx, error: errorMessage, errorCode },
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
                    ...platformSpecific,
                    error: errorMessage,
                    errorCode,
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
        errorCode: tokenErrorCodeOf(result.reason),
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

export const publishToAllAction = returnRefusals(publishToAllHandler);

/**
 * A failed publish's stored reason, as the page shows it: a sentence, with
 * the token code beside it for support (KB-157). A row written before then
 * holds the bare code as its `error`.
 */
function storedFailure(metadata: unknown, platform: string) {
  const { error, errorCode } = (metadata ?? {}) as {
    error?: unknown;
    errorCode?: unknown;
  };

  if (typeof error !== 'string') return {};

  const code = isTokenErrorCode(errorCode) ? errorCode : error;

  return {
    error: readableTokenError(error, platform),
    ...(isTokenErrorCode(code) && { errorCode: code }),
  };
}

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
          ...storedFailure(metadata, publish.platform),
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
const retryPublish = enhanceAction(
  async ({ publishId }, _user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.retry', publishId };

    logger.info(ctx, 'Retrying failed publish');

    const client = getSupabaseServerClient();

    // Get publish record
    const publish = requireRow(
      await client
        .from('publishes')
        .select(
          `
        id, episode_id, platform_connection_id, platform, content_type, status,
        title, description, tags, thumbnail_url, platform_content_id, platform_url,
        scheduled_at, published_at, language, metadata, created_at, ai_generated,
        episodes(final_video_url, thumbnail_url, project_id, project:projects!inner(account_id))
      `,
        )
        .eq('id', publishId)
        .single(),
      'Publish record not found',
    );

    if (publish.status !== 'failed') {
      throw new ActionRefusal('Can only retry failed publishes');
    }

    const episode = publish.episodes;

    if (!episode?.final_video_url) {
      throw new ActionRefusal('Episode video not available');
    }

    // Only a file of this episode's own project is sent (KB-123)
    const videoUrl = await ownedEpisodeVideo(
      episode.final_video_url,
      { episodeId: publish.episode_id, projectId: episode.project_id },
      projectOfEpisodeVia(client),
    );

    if (!videoUrl) {
      throw new ActionRefusal(EPISODE_VIDEO_PUBLISH_REFUSAL);
    }

    // Get access token
    if (!publish.platform_connection_id) {
      throw new Error('Platform connection ID is missing');
    }

    // KB-109: the publish's channel is one of its episode's account
    await assertConnectionOfAccount(
      client,
      publish.platform_connection_id,
      episode.project.account_id,
    );
    await assertConnectionOfProject(
      client,
      [publish.platform_connection_id],
      episode.project_id,
    );

    const tokenResult = await getAccessToken(publish.platform_connection_id);
    if (tokenResult.error !== undefined) {
      throw new TokenRefusal(tokenResult.error, publish.platform);
    }
    const accessToken = tokenResult.accessToken;

    // Get connection
    const { data: connection } = await client
      .from('platform_connections')
      .select(
        'platform_account_id, platform_account_name, youtube_made_for_kids, youtube_category_id, scopes',
      )
      .eq('id', publish.platform_connection_id)
      .single();

    if (!connection) {
      throw new ActionRefusal('Platform connection not found');
    }

    // FILM-1729: a retry cannot succeed until the account is reconnected
    if (
      publish.platform === 'twitter' &&
      !holdsXUploadScope(connection.scopes)
    ) {
      throw new ActionRefusal(
        xUploadScopeRefusal([
          connection.platform_account_name ?? 'this X account',
        ]),
      );
    }

    // KB-30: a row scheduled before the audience was asked for carries no
    // snapshot, so the channel answers; with neither, the retry is refused
    // before anything changes, and the message says where to declare it.
    const metadata = (publish.metadata ?? {}) as Record<string, unknown>;
    let platformSpecific = metadata;

    if (publish.platform === 'youtube') {
      try {
        platformSpecific = {
          ...metadata,
          ...resolveYouTubeDeclaration(metadata, connection),
        };
      } catch (error) {
        if (error instanceof YouTubeDeclarationMissing) {
          throw new ActionRefusal(
            refusalFor([connection.platform_account_name ?? 'this channel']),
          );
        }
        throw error;
      }
    }

    // Update status to publishing. A retry RLS refuses changes no row: it
    // stops here, before the upload, rather than publishing anyway (KB-105).
    const { data: marked, error: markError } = await client
      .from('publishes')
      .update({ status: 'publishing' })
      .eq('id', publishId)
      .select('id');

    if (markError) {
      throw new Error(`Failed to start the retry: ${markError.message}`);
    }

    requireAffectedRows(marked, "You can't retry this publish.");

    try {
      const uploadResult = await uploadToPlatform(
        publish.platform as Platform,
        accessToken,
        connection.platform_account_id ?? '',
        {
          videoUrl,
          title: publish.title ?? '',
          description: publish.description ?? '',
          tags: publish.tags ?? [],
          thumbnailUrl:
            ownedEpisodeThumbnail(publish.thumbnail_url, publish.episode_id) ??
            ownedEpisodeThumbnail(episode.thumbnail_url, publish.episode_id),
          platformSpecific,
          aiGenerated: publish.ai_generated,
        },
        connection,
      );

      await client
        .from('publishes')
        .update({
          status: 'published',
          metadata: JSON.parse(JSON.stringify(platformSpecific)),
          platform_content_id: uploadResult.contentId,
          platform_url: uploadResult.url,
          published_at: new Date().toISOString(),
        })
        .eq('id', publishId);

      // FILM-1710
      await recordUploadedFileDuration(
        getSupabaseServerAdminClient,
        { id: publishId, platform: publish.platform },
        videoUrl,
      );

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
            errorCode: tokenErrorCodeOf(error),
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

export const retryPublishAction = returnRefusals(retryPublish);

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
    /** The publish's AI declaration, sent where the platform has a field (FILM-1731) */
    aiGenerated: boolean;
  },
  channel: YouTubeChannelDeclaration | null,
): Promise<{ contentId: string; url: string }> {
  switch (platform) {
    case 'youtube':
      // Always public: scheduling is handled server-side by the cron job.
      return uploadToYouTube(
        accessToken,
        { ...options, privacy: 'public' },
        channel,
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
    description: string;
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

    // A kept publish on a hidden platform (X while `X_ENABLED` is off) is
    // not shown.
    const shown = (publishes ?? []).filter((p) =>
      isOfferedPlatform(p.platform),
    );

    return shown.map((p) => {
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
        // Null when nobody set one; not defaulted to a language (FILM-1702).
        language: p.language,
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
        ...storedFailure(p.metadata, p.platform),
      };
    });
  },
  {
    schema: GetPublishStatusSchema,
    auth: true,
  },
);

/**
 * The caller may take this episode's videos down, or a refusal (KB-47).
 * Takedown is irreversible, so it asks for owner or admin on the episode's
 * project (`TAKEDOWN_ROLES`), not the read access that let any member of
 * the account queue it before.
 */
async function assertCanTakeDown(
  client: SupabaseClient<Database>,
  episodeId: string,
  userId: string,
) {
  const { data: episode, error } = await client
    .from('episodes')
    .select('project_id')
    .eq('id', episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the episode: ${error.message}`);
  }

  if (!episode) {
    throw new ActionRefusal('Publish record not found');
  }

  const role = await projectRoleOf(client, episode.project_id, userId);

  if (!canTakeDown(role)) {
    throw new ActionRefusal(TAKEDOWN_REFUSAL);
  }
}

interface MarkedPublish {
  id: string;
  platform: string;
  platform_content_id: string | null;
  platform_connection_id: string | null;
  episode_id: string;
}

const MARKED_COLUMNS =
  'id, platform, platform_content_id, platform_connection_id, episode_id';

/**
 * Sends one delete job per publish the caller's update marked 'deleting'.
 * Only those: a row the update did not return is one RLS would not let the
 * caller change, and the worker deletes nothing that is not 'deleting'. A
 * publish whose job could not be sent goes back to the status it had.
 */
async function queueDeleteJobs(
  client: SupabaseClient<Database>,
  marked: MarkedPublish[],
  previousStatus: Map<string, string>,
  userId: string,
) {
  const sent = await Promise.allSettled(
    marked.map((pub) => {
      const message: DeleteJobMessage = {
        type: 'delete',
        publishId: pub.id,
        userId,
        platformConnectionId: pub.platform_connection_id ?? '',
        episodeId: pub.episode_id,
        platform: pub.platform as DeleteJobMessage['platform'],
        platformContentId: pub.platform_content_id || '',
      };

      return sqsClient.send(
        new SendMessageCommand({
          QueueUrl: PUBLISH_QUEUE_URL,
          MessageBody: JSON.stringify(message),
        }),
      );
    }),
  );

  const unsent = marked.filter(
    (_, index) => sent[index]?.status === 'rejected',
  );

  for (const pub of unsent) {
    await client
      .from('publishes')
      .update({ status: previousStatus.get(pub.id) ?? 'published' })
      .eq('id', pub.id);
  }

  return { queued: marked.length - unsent.length, failed: unsent.length };
}

/**
 * Deletes all publish records for an episode AND removes content from platforms
 * Used for cleanup/testing purposes.
 * Now uses async worker to avoid timeouts.
 */
const deleteEpisodePublishesHandler = enhanceAction(
  async ({ episodeId }, user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.deleteEpisodePublishes', episodeId };

    logger.info(ctx, 'Deleting all publish records for episode (async)');

    const client = getSupabaseServerClient();

    await assertCanTakeDown(client, episodeId, user.id);

    if (!PUBLISH_QUEUE_URL) {
      logger.error(ctx, 'PUBLISH_QUEUE_URL not configured');
      throw new Error('System configuration error: Queue URL missing');
    }

    const { data: publishes, error: readError } = await client
      .from('publishes')
      .select('id, status')
      .eq('episode_id', episodeId);

    if (readError) {
      throw new Error(`Could not read the publishes: ${readError.message}`);
    }

    if (!publishes || publishes.length === 0) {
      logger.info(ctx, 'No publish records to delete');
      return { success: true, deletedCount: 0, platformErrors: [] };
    }

    const { data: marked, error: markError } = await client
      .from('publishes')
      .update({ status: 'deleting' })
      .eq('episode_id', episodeId)
      .select(MARKED_COLUMNS);

    if (markError) {
      throw new Error(`Could not mark the publishes: ${markError.message}`);
    }

    const { queued, failed } = await queueDeleteJobs(
      client,
      marked ?? [],
      new Map(publishes.map((pub) => [pub.id, pub.status])),
      user.id,
    );

    // Analytics are stored in ClickHouse — no Supabase cleanup needed

    logger.info(
      { ...ctx, count: queued, failed },
      'Enqueued delete jobs for publish records',
    );

    if (queued === 0 && failed > 0) {
      throw new Error('Could not queue the deletions');
    }

    return {
      success: true,
      deletedCount: queued,
      platformErrors: [],
    };
  },
  {
    schema: GetPublishStatusSchema,
    auth: true,
  },
);

export const deleteEpisodePublishesAction = returnRefusals(
  deleteEpisodePublishesHandler,
);

/**
 * Unpublish a single publish record - deletes from platform AND database
 * Now uses async worker to avoid timeouts.
 */
const unpublishHandler = enhanceAction(
  async ({ publishId }, user) => {
    const logger = await getLogger();
    const ctx = { name: 'publishing.unpublish', publishId };

    logger.info(ctx, 'Unpublishing content from platform (async)');

    const client = getSupabaseServerClient();

    const publish = requireRow(
      await client
        .from('publishes')
        .select('id, episode_id, status')
        .eq('id', publishId)
        .single(),
      'Publish record not found',
    );

    await assertCanTakeDown(client, publish.episode_id, user.id);

    if (!PUBLISH_QUEUE_URL) {
      logger.error(ctx, 'PUBLISH_QUEUE_URL not configured');
      throw new Error('System configuration error: Queue URL missing');
    }

    const { data: marked, error: markError } = await client
      .from('publishes')
      .update({ status: 'deleting' })
      .eq('id', publishId)
      .select(MARKED_COLUMNS);

    if (markError) {
      throw new Error(`Could not mark the publish: ${markError.message}`);
    }

    if (!marked || marked.length === 0) {
      throw new ActionRefusal('Publish record not found');
    }

    const { failed } = await queueDeleteJobs(
      client,
      marked,
      new Map([[publish.id, publish.status]]),
      user.id,
    );

    if (failed > 0) {
      throw new Error('Could not queue the unpublish');
    }

    logger.info(ctx, 'Unpublish job enqueued');

    return { success: true };
  },
  {
    schema: z.object({ publishId: z.string().uuid() }),
    auth: true,
  },
);

export const unpublishAction = returnRefusals(unpublishHandler);
