import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';
import { requireRow } from '@kit/next/refusals';
import {
  holdsXUploadScope,
  xUploadScopeRefusal,
  xVideoRefusal,
} from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

import {
  PUBLISH_NOW_PRECEDENCE,
  resolveEpisodeVideo,
} from '../lib/episode-video';
import { readMp4Facts } from '../lib/mp4-facts';
import {
  type ProjectOfEpisode,
  ownedEpisodeVideo,
} from '../lib/owned-episode-video';
import { ownedEpisodeThumbnail } from '../lib/owned-thumbnail';
import { PLATFORM_NAMES } from '../lib/platforms';
import type { PublishToAllSchema } from '../lib/schemas/publish.schema';
import { groupTakesPlatform } from '../lib/shorts-targets';
import { tweetLength } from '../lib/tweet-length';
import {
  type YouTubeDeclaration,
  YouTubeDeclarationMissing,
  resolveYouTubeDeclaration,
} from '../lib/youtube-declaration';
import { TWITTER_CONSTRAINTS } from '../providers/twitter/types';
import { assertConnectionOfAccount } from './connection-account';
import { assertConnectionOfProject } from './project-channels';

/**
 * What a publish is checked against before any row is written, whether it
 * goes out now or at a scheduled time, and whoever asks: the Publish screen
 * (publishToAllAction) or an MCP connection (schedulePublishes). Each check
 * reads with the caller's own client, so RLS decides what is seen.
 */

type Client = SupabaseClient<Database>;

export type PublishPlatformInput = z.infer<
  typeof PublishToAllSchema
>['platforms'][number];

/** The project of an episode, read as the caller: RLS decides what is seen (KB-123) */
export function projectOfEpisodeVia(
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

export function refusalFor(channelNames: string[]) {
  const names = channelNames.map((name) => `“${name}”`).join(', ');

  return `Choose whether ${names} is made for kids, and its category, before publishing to YouTube. You can set this in Settings → Platforms.`;
}

/**
 * KB-30. The audience and category each YouTube upload will declare, by index
 * into `platforms` — from the request, else the channel's own answer. Refuses
 * the whole request, naming every undeclared channel, before anything is
 * written: there is no value this falls back to.
 */
async function declareYouTubeUploads(
  client: Client,
  platforms: PublishPlatformInput[],
) {
  const declared = new Map<number, YouTubeDeclaration>();
  const connectionIds = [
    ...new Set(
      platforms
        .filter((platform) => platform.platform === 'youtube')
        .map((platform) => platform.connectionId),
    ),
  ];

  if (connectionIds.length === 0) return declared;

  const { data: channels, error } = await client
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
  client: Client,
  platforms: PublishPlatformInput[],
  episode: Parameters<typeof resolveEpisodeVideo>[0] & { project_id: string },
  episodeId: string,
) {
  const toX = platforms.filter((platform) => platform.platform === 'twitter');

  if (toX.length === 0) return;

  const connections = await assertXUploadScope(client, toX);

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
        projectOfEpisodeVia(client),
      ));

    // The upload refuses these itself, with its own words.
    if (!videoUrl) continue;

    const refusal = xVideoRefusal(await readMp4Facts(videoUrl));

    if (refusal) throw new ActionRefusal(refusal);
  }
}

/** Refuses every X account that cannot upload video; returns the accounts. */
async function assertXUploadScope(
  client: Client,
  platforms: PublishPlatformInput[],
) {
  const connectionIds = [
    ...new Set(
      platforms
        .filter((platform) => platform.platform === 'twitter')
        .map((platform) => platform.connectionId),
    ),
  ];

  const { data: connections, error } = await client
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
 * Every refusal a publish gets before a row is written: the episode has a
 * video, each channel is the team's and the project's, each Shorts group
 * goes to the platform it is sent to, each thumbnail is the episode's own,
 * each YouTube upload declares its audience (KB-30), and X would accept it
 * (FILM-1729).
 */
export async function preparePublish(
  client: Client,
  episodeId: string,
  platforms: PublishPlatformInput[],
) {
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
  // of this episode's own uploads may be named.
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
  // creator chose, resolved before anything is written
  const declared = await declareYouTubeUploads(client, platforms);

  // FILM-1729: nothing goes to X that X would refuse
  await assertXWillAccept(client, platforms, episode, episodeId);

  return { episode, episodeThumbnail, declared };
}
