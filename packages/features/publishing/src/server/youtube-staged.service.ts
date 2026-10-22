import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import { tokenErrorMessage } from '../lib/token-errors';
import { HOLD_STEP_MS, youtubeStagingOf } from '../lib/youtube-staging';
import { YouTubeProvider } from '../providers/youtube/youtube-provider';
import { getAccessToken } from './connection-tokens';

/**
 * KB-214. A change to a post already uploaded to YouTube ahead of its time
 * acts on YouTube too: cancelling it deletes the private video, and moving
 * it moves YouTube's publish time. Refusals come back as words for the
 * person; nothing YouTube says is dropped. The scheduled job's check is the
 * backstop for a move that did not reach YouTube.
 */

type Client = SupabaseClient<Database>;

interface StagedRowLike {
  id: string;
  platform: string;
  platform_connection_id: string | null;
  metadata: unknown;
}

async function providerFor(
  connectionId: string,
): Promise<
  | { provider: YouTubeProvider; refusal?: never }
  | { provider?: never; refusal: string }
> {
  const token = await getAccessToken(connectionId);

  if (!token.accessToken) {
    return {
      refusal: tokenErrorMessage(token.error ?? 'NO_ACCESS_TOKEN', 'youtube'),
    };
  }

  return { provider: new YouTubeProvider(token.accessToken) };
}

/** Deletes a staged post's private video; a refusal, or null when done */
export async function deleteStagedYouTubeVideo(
  publish: StagedRowLike,
): Promise<string | null> {
  const staging = youtubeStagingOf(publish.metadata);

  if (publish.platform !== 'youtube' || !staging || staging.wentPublicAt) {
    return null;
  }

  if (!publish.platform_connection_id) {
    return 'This post was uploaded to YouTube ahead of its time, and its channel is gone, so it cannot be deleted there. Delete it in YouTube Studio.';
  }

  const access = await providerFor(publish.platform_connection_id);

  if (!access.provider) {
    return `It is uploaded to YouTube, private until its time, and could not be deleted there: ${access.refusal}`;
  }

  const { provider } = access;

  try {
    await provider.deleteVideoIfPresent(staging.videoId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * FILM-2213. Moves one staged post's publish time on YouTube, before its
 * row is moved, so the old, earlier time can never fire. A refusal, or
 * null when YouTube has the new time (or the post is not staged there).
 */
export async function moveStagedPublishAt(
  publish: StagedRowLike,
  publishAt: string,
): Promise<string | null> {
  const staging = youtubeStagingOf(publish.metadata);

  if (
    publish.platform !== 'youtube' ||
    !staging ||
    staging.goLiveWhenReady ||
    Math.abs(Date.parse(staging.publishAt) - Date.parse(publishAt)) < 1000
  ) {
    return null;
  }

  if (staging.wentPublicAt) {
    return 'It is already public on YouTube, so its time cannot change.';
  }

  if (!publish.platform_connection_id) {
    return 'It is uploaded to YouTube ahead of its time, and its channel is gone, so its time cannot change there. Change it in YouTube Studio.';
  }

  const access = await providerFor(publish.platform_connection_id);

  if (!access.provider) {
    return `It is uploaded to YouTube, private until its time, and its time could not be changed there: ${access.refusal}`;
  }

  try {
    const outcome = await access.provider.updatePublishAt(
      staging.videoId,
      publishAt,
    );

    if (outcome === 'public') {
      return 'It is already public on YouTube, so its time cannot change.';
    }
    if (outcome === 'gone') {
      return 'Its video is no longer on YouTube, so its time cannot change. Cancel it and schedule it again.';
    }

    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Moves YouTube's publish time of every staged post among `publishIds`
 * whose `scheduled_at` no longer matches it. Returns YouTube's refusals.
 */
export async function syncStagedPublishTimes(
  client: Client,
  publishIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (publishIds.length === 0) return [];

  const { data, error } = await client
    .from('publishes')
    .select(
      'id, platform, platform_connection_id, status, scheduled_at, metadata',
    )
    .in('id', publishIds)
    .eq('platform', 'youtube')
    .eq('status', 'scheduled')
    .not('metadata->youtube', 'is', null);

  if (error) {
    return [`Could not read the moved YouTube posts: ${error.message}`];
  }

  const refusals: string[] = [];

  for (const row of data ?? []) {
    const staging = youtubeStagingOf(row.metadata);

    if (
      !staging ||
      staging.wentPublicAt ||
      staging.goLiveWhenReady ||
      !row.scheduled_at ||
      Math.abs(Date.parse(row.scheduled_at) - Date.parse(staging.publishAt)) <
        1000 ||
      !row.platform_connection_id
    ) {
      continue;
    }

    const access = await providerFor(row.platform_connection_id);

    if (!access.provider) {
      refusals.push(access.refusal);
      continue;
    }

    const { provider } = access;

    const target =
      Date.parse(row.scheduled_at) > now.getTime() + 60_000
        ? row.scheduled_at
        : new Date(now.getTime() + HOLD_STEP_MS).toISOString();

    try {
      const outcome = await provider.updatePublishAt(staging.videoId, target);

      if (outcome !== 'set') continue;

      const { error: _cleared, ...rest } = staging;
      const { error: writeError } = await client
        .from('publishes')
        .update({
          scheduled_at: target,
          metadata: {
            ...(row.metadata as Record<string, unknown>),
            youtube: { ...rest, publishAt: target },
          } as unknown as Json,
        })
        .eq('id', row.id)
        .eq('status', 'scheduled');

      if (writeError) {
        refusals.push(
          `YouTube's time moved, but the post could not record it: ${writeError.message}`,
        );
      }
    } catch (moveError) {
      refusals.push(
        moveError instanceof Error ? moveError.message : String(moveError),
      );
    }
  }

  return refusals;
}
