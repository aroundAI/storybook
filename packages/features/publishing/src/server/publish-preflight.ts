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
  pickEpisodeThumbnail,
  readEpisodeThumbnails,
} from '../lib/episode-thumbnail';
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
import {
  hasVideoLimits,
  platformVideoRefusal,
} from '../lib/platform-video-limits';
import { PLATFORM_NAMES } from '../lib/platforms';
import type { PublishToAllSchema } from '../lib/schemas/publish.schema';
import { groupTakesPlatform } from '../lib/shorts-targets';
import { tweetLength } from '../lib/tweet-length';
import {
  type YouTubeDeclaration,
  YouTubeDeclarationMissing,
  resolveYouTubeDeclaration,
} from '../lib/youtube-declaration';
import {
  longUploadsStatusOf,
  youtubeLengthRefusal,
} from '../lib/youtube-long-uploads';
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
  episode: PreflightEpisode,
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

    const videoUrl = await videoOfTarget(
      client,
      platform,
      platform.language ??
        connections.find((row) => row.id === platform.connectionId)?.language,
      episode,
      episodeId,
    );

    // The upload refuses these itself, with its own words.
    if (!videoUrl) continue;

    const refusal = xVideoRefusal(await readMp4Facts(videoUrl));

    if (refusal) throw new ActionRefusal(refusal);
  }
}

type PreflightEpisode = Parameters<typeof resolveEpisodeVideo>[0] & {
  project_id: string;
};

/** The video a target would send: the one the upload resolves, if owned */
async function videoOfTarget(
  client: Client,
  platform: PublishPlatformInput,
  language: string | null | undefined,
  episode: PreflightEpisode,
  episodeId: string,
) {
  const short = platform.contentType === 'short';
  const resolved = resolveEpisodeVideo(episode, {
    language: language ?? 'en',
    platform: platform.platform,
    short,
    shortsGroupId: short ? platform.shortsGroupId : null,
    ...PUBLISH_NOW_PRECEDENCE,
  });

  return (
    resolved &&
    (await ownedEpisodeVideo(
      resolved.url,
      { episodeId, projectId: episode.project_id },
      projectOfEpisodeVia(client),
    ))
  );
}

/**
 * FILM-2212. Refuses, before anything is written, a video Facebook or
 * Instagram would refuse for its size or length: StoryBook takes uploads up
 * to `MAX_VIDEO_UPLOAD_BYTES`, and both platforms take less. Read from the
 * file's own header and size, as for X; a fact the file does not give is
 * left to the upload.
 */
async function assertPlatformsWillAccept(
  client: Client,
  platforms: PublishPlatformInput[],
  episode: PreflightEpisode,
  episodeId: string,
) {
  const limited = platforms.filter((platform) =>
    hasVideoLimits(platform.platform),
  );

  if (limited.length === 0) return;

  const { data: connections, error } = await client
    .from('platform_connections')
    .select('id, language')
    .in('id', [...new Set(limited.map((platform) => platform.connectionId))]);

  if (error) {
    throw new Error('Could not read the channels being published to');
  }

  const factsOf = new Map<string, ReturnType<typeof readMp4Facts>>();

  for (const platform of limited) {
    if (!hasVideoLimits(platform.platform)) continue;

    const videoUrl = await videoOfTarget(
      client,
      platform,
      platform.language ??
        connections?.find((row) => row.id === platform.connectionId)?.language,
      episode,
      episodeId,
    );

    if (!videoUrl) continue;

    if (!factsOf.has(videoUrl)) factsOf.set(videoUrl, readMp4Facts(videoUrl));

    const refusal = platformVideoRefusal(
      platform.platform,
      await factsOf.get(videoUrl)!,
    );

    if (refusal) throw new ActionRefusal(refusal);
  }
}

/**
 * KB-205. Refuses, before anything is written, a video over 15 minutes to a
 * YouTube channel not known to be verified for long uploads: YouTube takes
 * the bytes, then abandons it as "too long". A channel whose status was
 * never read (connected before KB-205) is refused too, saying how to check.
 * The file is read only for such a channel.
 */
async function assertYouTubeWillAccept(
  client: Client,
  platforms: PublishPlatformInput[],
  episode: PreflightEpisode,
  episodeId: string,
) {
  const toYouTube = platforms.filter(
    (platform) => platform.platform === 'youtube',
  );

  if (toYouTube.length === 0) return;

  const { data: channels, error } = await client
    .from('platform_connections')
    .select('id, platform_account_name, language, metadata')
    .in('id', [...new Set(toYouTube.map((platform) => platform.connectionId))]);

  if (error) {
    throw new Error('Could not read the YouTube channels being published to');
  }

  for (const platform of toYouTube) {
    const channel = channels?.find((row) => row.id === platform.connectionId);
    const status = longUploadsStatusOf(channel?.metadata);

    if (status === 'allowed') continue;

    const videoUrl = await videoOfTarget(
      client,
      platform,
      platform.language ?? channel?.language,
      episode,
      episodeId,
    );

    if (!videoUrl) continue;

    const refusal = youtubeLengthRefusal(
      channel?.platform_account_name ?? 'this YouTube channel',
      status,
      (await readMp4Facts(videoUrl)).durationSeconds,
    );

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
 * each YouTube upload declares its audience (KB-30), and X, Facebook,
 * Instagram and YouTube would accept it (FILM-1729, FILM-2212, KB-205).
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

  // KB-210: a long video's thumbnail when the caller names none: the
  // episode's in the video's language, else its default, else the legacy
  // episode column. Only one of the episode's own uploads (KB-104).
  const thumbnails = platforms.some(
    (platform) => platform.contentType !== 'short' && !platform.thumbnailUrl,
  )
    ? await readEpisodeThumbnails(client, episodeId)
    : [];
  const episodeThumbnail = (language: string | null | undefined) =>
    ownedEpisodeThumbnail(
      pickEpisodeThumbnail(thumbnails, language),
      episodeId,
    ) ?? ownedEpisodeThumbnail(episode.thumbnail_url, episodeId);

  // KB-30: every YouTube upload declares an audience and a category the
  // creator chose, resolved before anything is written
  const declared = await declareYouTubeUploads(client, platforms);

  // FILM-1729: nothing goes to X that X would refuse
  await assertXWillAccept(client, platforms, episode, episodeId);

  // FILM-2212: nor to Facebook or Instagram, whose limits are below ours
  await assertPlatformsWillAccept(client, platforms, episode, episodeId);

  // KB-205: nor a long video to a YouTube channel that may not take one
  await assertYouTubeWillAccept(client, platforms, episode, episodeId);

  return { episode, episodeThumbnail, declared };
}
