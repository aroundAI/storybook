import 'server-only';

import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '@kit/publishing/lib/constants';
import {
  cancelScheduledPublish,
  schedulePublishes,
} from '@kit/publishing/server/schedule-publishes';

import { McpToolError } from '../../../errors';
import { type McpToolDefinition, defineTool } from '../../../registry';
import { type EpisodeRef, requireEpisodeInAccount } from '../read/scope';
import { refused } from '../validation';
import { shortsGroupTools } from './shorts';

/**
 * Scheduling publishes over MCP (owner, 2026-10-10): an episode's video,
 * or one of its Shorts groups, to a channel of its project at a future
 * time. Nothing reaches a platform until the scheduled job runs, and a
 * scheduled publish can be cancelled until then. Publishing now stays a
 * web action. Both writes need `studio:publish`, which a person ticks on
 * the consent screen themselves.
 */

const PUBLISH = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const TargetSchema = z.object({
  connectionId: z
    .string()
    .uuid()
    .describe(
      'The channel (list_channels with the projectId). Its platform is the channel’s own.',
    ),
  contentType: z
    .enum(['full', 'short'])
    .describe('full: the episode video. short: a Shorts group’s video.'),
  shortsGroupId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'For a short: the Shorts group (list_episode_publishes). It must be set to go to this channel’s platform.',
    ),
  title: z.string().min(1).max(5000),
  description: z.string().max(70000).default(''),
  tags: z.array(z.string().min(1).max(100)).max(100).default([]),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .describe(
      'When it goes out, as ISO 8601 with a time zone, e.g. 2026-10-12T18:30:00+05:30. Must be in the future.',
    ),
  language: z
    .enum(SUPPORTED_LANGUAGES)
    .optional()
    .describe(
      'The video’s language; the channel’s own language when left out.',
    ),
  youtube: z
    .object({
      madeForKids: z.boolean().optional(),
      categoryId: z.string().optional(),
      privacy: z.enum(['private', 'unlisted', 'public']).optional(),
    })
    .optional()
    .describe(
      'YouTube only. The audience and category default to the channel’s own answer in Settings → Platforms; a channel with none set is refused until one is given.',
    ),
});

export const schedulePublishTool = defineTool({
  name: 'schedule_publish',
  title: 'Schedule a publish',
  description:
    "Schedules an episode's video, or one of its Shorts groups, to post on channels of its project at a future time: one target per channel. Every target is checked first, as the Publish screen checks a publish (the channel is the project's and still connected, the video exists in that language, a Shorts group goes to that platform, YouTube's audience is declared), and a refused target schedules nothing. Nothing reaches a platform until the scheduled time; cancel_scheduled_publish undoes one before then. Publishing immediately is done on the Publish screen.",
  inputSchema: {
    episodeId: z.string().uuid(),
    targets: z.array(TargetSchema).min(1).max(20),
    aiGenerated: z
      .boolean()
      .default(false)
      .describe(
        'Label the video as AI-generated on the platforms that have such a label.',
      ),
  },
  scope: 'studio:publish',
  annotations: PUBLISH,
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const result = await schedulePublishes(client, context.principal.userId, {
      episodeId: input.episodeId,
      aiGenerated: input.aiGenerated,
      targets: input.targets.map(({ youtube, ...target }) => ({
        ...target,
        platformSpecific: youtube ?? {},
      })),
    });

    if (!result.ok) {
      throw refused(result.refusal, 'targets');
    }

    const lines = result.data.map(
      (row) =>
        `- ${row.platform} ${row.contentType} (${row.language}) at ${row.scheduledAt}: publish ${row.publishId}`,
    );

    return {
      text: `Scheduled ${result.data.length} publish${result.data.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`,
      structuredContent: {
        episodeId: input.episodeId,
        scheduled: result.data,
      },
    };
  },
});

export const cancelScheduledPublishTool = defineTool({
  name: 'cancel_scheduled_publish',
  title: 'Cancel a scheduled publish',
  description:
    'Cancels a scheduled publish before it goes out, removing it. One that has started or gone out is refused: take a published video down on the Publish screen. Project owners and admins.',
  inputSchema: {
    publishId: z
      .string()
      .uuid()
      .describe('From schedule_publish or list_episode_publishes.'),
  },
  scope: 'studio:publish',
  annotations: { ...PUBLISH, destructiveHint: true, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    const { data: publish } = await client
      .from('publishes')
      .select('episode_id')
      .eq('id', input.publishId)
      .maybeSingle();

    if (!publish) {
      throw new McpToolError('NOT_FOUND', 'Publish record not found');
    }

    await requireEpisodeInAccount(
      client,
      context.accountId,
      publish.episode_id,
      'id',
    );

    const result = await cancelScheduledPublish(
      client,
      context.principal.userId,
      input.publishId,
    );

    if (!result.ok) {
      throw refused(result.refusal, 'publishId');
    }

    return {
      text: `Cancelled the scheduled publish ${input.publishId}; nothing was posted.`,
      structuredContent: { ...result.data, cancelled: true },
    };
  },
});

export const listEpisodePublishesTool = defineTool({
  name: 'list_episode_publishes',
  title: 'List an episode’s publishes',
  description:
    "An episode's Shorts groups (id, name, the title, description and tags its shorts post with, the platforms each goes to, where none means every Shorts platform, and its languages) and its publishes: each with its platform, channel, content type, language, status (scheduled, queued, publishing, published, failed, …), scheduled time and platform URL. The ids are what schedule_publish and cancel_scheduled_publish take.",
  inputSchema: { episodeId: z.string().uuid() },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<
      EpisodeRef & { localized_videos: unknown; shorts_groups: unknown }
    >(
      client,
      context.accountId,
      input.episodeId,
      'id, localized_videos, shorts_groups',
    );

    const { data: publishes, error } = await client
      .from('publishes')
      .select(
        'id, platform, platform_connection_id, content_type, language, status, scheduled_at, published_at, platform_url, metadata',
      )
      .eq('episode_id', input.episodeId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
      .order('id');

    if (error) {
      throw new Error(`Could not read the publishes: ${error.message}`);
    }

    const groups = (
      Array.isArray(episode.shorts_groups) ? episode.shorts_groups : []
    ) as Array<{
      id: string;
      name?: string;
      title?: string;
      description?: string;
      tags?: string[];
      platforms?: string[];
      videos?: Record<string, string>;
    }>;

    const shortsGroups = groups.map((group) => ({
      id: group.id,
      name: group.name ?? '',
      title: group.title ?? '',
      description: group.description ?? '',
      tags: group.tags ?? [],
      platforms: group.platforms ?? [],
      languages: Object.entries(group.videos ?? {})
        .filter(([, url]) => url)
        .map(([language]) => language),
    }));

    const rows = (publishes ?? []).map((row) => ({
      publishId: row.id,
      platform: row.platform,
      connectionId: row.platform_connection_id,
      contentType: row.content_type,
      shortsGroupId:
        (row.metadata as { shortsGroupId?: string | null } | null)
          ?.shortsGroupId ?? null,
      language: row.language,
      status: row.status,
      scheduledAt: row.scheduled_at,
      publishedAt: row.published_at,
      platformUrl: row.platform_url,
    }));

    const scheduled = rows.filter((row) => row.status === 'scheduled').length;

    return {
      text: `${shortsGroups.length} Shorts group${shortsGroups.length === 1 ? '' : 's'}; ${rows.length} publish${rows.length === 1 ? '' : 'es'}, ${scheduled} scheduled.`,
      structuredContent: {
        episodeId: input.episodeId,
        videoLanguages: Object.keys(
          (episode.localized_videos as Record<string, string> | null) ?? {},
        ),
        shortsGroups,
        publishes: rows,
      },
    };
  },
});

export const publishTools = [
  listEpisodePublishesTool,
  ...shortsGroupTools,
  schedulePublishTool,
  cancelScheduledPublishTool,
] as unknown as McpToolDefinition[];
