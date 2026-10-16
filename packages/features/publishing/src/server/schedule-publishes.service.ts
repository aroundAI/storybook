import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import type { Database } from '@kit/supabase/database';

import {
  SCHEDULED_LAMBDA_PRECEDENCE,
  resolveEpisodeVideo,
} from '../lib/episode-video';
import { PLATFORM_NAMES, isOfferedPlatform } from '../lib/platforms';
import { canTakeDown, projectRoleOf } from '../lib/takedown';
import { TokenRefusal } from '../lib/token-errors';
import { getAccessToken } from './connection-tokens';
import { type PublishPlatformInput, preparePublish } from './publish-preflight';

/**
 * Scheduling a publish from outside the Publish screen: the MCP
 * schedule_publish and cancel_scheduled_publish tools. A scheduled publish
 * is a `publishes` row with status `scheduled`; nothing reaches a platform
 * until the scheduled job claims it, so until then it can be cancelled.
 * Publishing now stays a web action (owner, 2026-10-10).
 *
 * Every target is checked before any row is written, by the same
 * preparePublish the Publish screen runs, and then all rows are written in
 * one insert: a refused target schedules nothing.
 */

type Client = SupabaseClient<Database>;

type Result<T> = { ok: true; data: T } | { ok: false; refusal: string };

export interface ScheduleTarget {
  connectionId: string;
  contentType: 'full' | 'short';
  shortsGroupId?: string | null;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl?: string | null;
  scheduledAt: string;
  /** The video's language; the channel's own language when absent */
  language?: string;
  platformSpecific: PublishPlatformInput['platformSpecific'];
}

export interface ScheduledPublish {
  publishId: string;
  connectionId: string;
  platform: string;
  contentType: 'full' | 'short';
  shortsGroupId: string | null;
  language: string;
  scheduledAt: string;
}

/** The roles `publishes_delete` allows, as TAKEDOWN_ROLES lists them */
export const CANCEL_REFUSAL =
  'Only project owners and admins can cancel a scheduled publish.';

export async function schedulePublishes(
  client: Client,
  userId: string,
  input: {
    episodeId: string;
    targets: ScheduleTarget[];
    aiGenerated: boolean;
    now?: Date;
  },
): Promise<Result<ScheduledPublish[]>> {
  try {
    return { ok: true, data: await schedule(client, userId, input) };
  } catch (error) {
    if (error instanceof ActionRefusal) {
      return { ok: false, refusal: error.message };
    }

    throw error;
  }
}

async function schedule(
  client: Client,
  userId: string,
  input: {
    episodeId: string;
    targets: ScheduleTarget[];
    aiGenerated: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();

  for (const target of input.targets) {
    if (new Date(target.scheduledAt).getTime() <= now.getTime()) {
      throw new ActionRefusal(
        `A scheduled time must be in the future; ${target.scheduledAt} is not. Publishing now is done on the Publish screen.`,
      );
    }
  }

  // The platform is the channel's own, never the caller's word for it
  const connectionIds = [...new Set(input.targets.map((t) => t.connectionId))];
  const { data: channels, error } = await client
    .from('platform_connections')
    .select('id, platform, language')
    .in('id', connectionIds);

  if (error) {
    throw new Error(`Could not read the channels: ${error.message}`);
  }

  const platforms: PublishPlatformInput[] = input.targets.map((target) => {
    const channel = channels?.find((row) => row.id === target.connectionId);

    if (!channel) {
      throw new ActionRefusal(
        'That channel is not one of this team’s. Call list_channels for the project’s channels.',
      );
    }

    if (!isOfferedPlatform(channel.platform)) {
      throw new ActionRefusal(
        `StoryBook does not publish to ${channel.platform} at the moment.`,
      );
    }

    if (target.contentType === 'short' && !target.shortsGroupId) {
      throw new ActionRefusal(
        'A short names its Shorts group (shortsGroupId, from get_episode).',
      );
    }

    const language = target.language ?? channel.language;

    if (!language) {
      throw new ActionRefusal(
        'Say which language the video is in (language): this channel has no language set.',
      );
    }

    return {
      platform: channel.platform,
      connectionId: target.connectionId,
      contentType: target.contentType,
      shortsGroupId:
        target.contentType === 'short' ? target.shortsGroupId : null,
      title: target.title,
      description: target.description,
      tags: target.tags,
      thumbnailUrl: target.thumbnailUrl ?? null,
      scheduledAt: target.scheduledAt,
      platformSpecific: target.platformSpecific,
      language,
    };
  });

  const { episode, episodeThumbnail, declared } = await preparePublish(
    client,
    input.episodeId,
    platforms,
  );

  // The video the scheduled Lambda will send exists now, under its own rule
  for (const platform of platforms) {
    const short = platform.contentType === 'short';
    const resolved = resolveEpisodeVideo(episode, {
      language: platform.language ?? 'en',
      platform: platform.platform,
      short,
      shortsGroupId: short ? platform.shortsGroupId : null,
      ...SCHEDULED_LAMBDA_PRECEDENCE,
    });

    if (!resolved) {
      throw new ActionRefusal(
        short
          ? `That Shorts group has no ${platform.language} video for ${PLATFORM_NAMES[platform.platform]}. Upload it on the Publish screen first.`
          : `This episode has no ${platform.language} video. Attach one with request_episode_video_upload first.`,
      );
    }
  }

  // Each channel can still be published to, as the Publish screen checks
  for (const platform of platforms) {
    const token = await getAccessToken(platform.connectionId);

    if (token.error !== undefined) {
      throw new TokenRefusal(token.error, platform.platform);
    }
  }

  const { data: rows, error: insertError } = await client
    .from('publishes')
    .insert(
      platforms.map((platform, index) => ({
        episode_id: input.episodeId,
        platform_connection_id: platform.connectionId,
        platform: platform.platform,
        content_type: platform.contentType,
        title: platform.title,
        description: platform.description,
        tags: platform.tags,
        thumbnail_url: platform.thumbnailUrl ?? episodeThumbnail,
        status: 'scheduled',
        scheduled_at: platform.scheduledAt,
        metadata: JSON.parse(
          JSON.stringify({
            ...platform.platformSpecific,
            ...declared.get(index),
            shortsGroupId: platform.shortsGroupId,
            createdBy: userId,
            createdVia: 'mcp',
          }),
        ),
        language: platform.language!,
        ai_generated: input.aiGenerated,
      })),
    )
    .select(
      'id, platform_connection_id, platform, content_type, language, scheduled_at, metadata',
    );

  if (insertError || !rows) {
    throw new Error(
      `Could not schedule the publishes: ${insertError?.message ?? 'no rows'}`,
    );
  }

  return rows.map((row) => ({
    publishId: row.id,
    connectionId: row.platform_connection_id ?? '',
    platform: row.platform,
    contentType: row.content_type === 'short' ? 'short' : 'full',
    shortsGroupId:
      (row.metadata as { shortsGroupId?: string | null } | null)
        ?.shortsGroupId ?? null,
    language: row.language ?? '',
    scheduledAt: row.scheduled_at ?? '',
  })) satisfies ScheduledPublish[];
}

/**
 * Cancels a publish that has not started: its row is deleted while it is
 * still `scheduled`, so one the scheduled job has claimed is refused rather
 * than raced. `publishes_delete` lets project owners and admins delete, and
 * the same roles are asked first so the refusal says why.
 */
export async function cancelScheduledPublish(
  client: Client,
  userId: string,
  publishId: string,
): Promise<Result<{ publishId: string; episodeId: string }>> {
  const { data: publish, error } = await client
    .from('publishes')
    .select('id, episode_id, status, episodes!inner(project_id)')
    .eq('id', publishId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the publish: ${error.message}`);
  }

  if (!publish) {
    return { ok: false, refusal: 'Publish record not found' };
  }

  if (publish.status !== 'scheduled') {
    return {
      ok: false,
      refusal: `That publish is ${publish.status}, not scheduled, so it can't be cancelled.`,
    };
  }

  const role = await projectRoleOf(client, publish.episodes.project_id, userId);

  if (!canTakeDown(role)) {
    return { ok: false, refusal: CANCEL_REFUSAL };
  }

  const { data: deleted, error: deleteError } = await client
    .from('publishes')
    .delete()
    .eq('id', publishId)
    .eq('status', 'scheduled')
    .select('id');

  if (deleteError) {
    throw new Error(`Could not cancel the publish: ${deleteError.message}`);
  }

  if (!deleted?.length) {
    return {
      ok: false,
      refusal:
        'That publish started just now, so it can no longer be cancelled.',
    };
  }

  return { ok: true, data: { publishId, episodeId: publish.episode_id } };
}
