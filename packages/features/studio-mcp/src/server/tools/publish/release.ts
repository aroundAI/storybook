import 'server-only';

import { z } from 'zod';

import {
  type BreakingMove,
  QUEUE_WARNING_DAYS,
  type ShortsQueueSummary,
} from '@kit/publishing/lib/cadence/release-types';
import { SUPPORTED_LANGUAGES } from '@kit/publishing/lib/constants';
import {
  pickEpisodeThumbnail,
  readEpisodeThumbnails,
} from '@kit/publishing/lib/episode-thumbnail';
import { MAX_CALENDAR_DAYS } from '@kit/publishing/lib/schedule-view';
import { ChannelCadenceSchema } from '@kit/publishing/lib/schemas/schedule-release';
import { readPublishCalendar } from '@kit/publishing/server/publish-calendar';
import {
  discardHeldShorts,
  previewBreakingRelease,
  previewCadenceRelease,
  readChannelCadences,
  requeueHeldShorts,
  saveChannelCadence,
  scheduleBreakingRelease,
  scheduleCadenceRelease,
} from '@kit/publishing/server/schedule-release';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { type McpToolDefinition, defineTool } from '../../../registry';
import {
  requireEpisodeInAccount,
  requireProjectInAccount,
} from '../read/scope';
import { refused } from '../validation';

/**
 * FILM-2208: a release on each channel's posting cadence (FILM-719) over
 * MCP, so a client that uploads a folder of episodes can schedule them the
 * way the Schedule Release panel does: the long video in the channel's next
 * free slot, its Shorts at the end of the channel's Shorts queue, oldest
 * first (FILM-2209), each Short waiting for its long video to go out. Every
 * tool calls the function the Publish screen calls.
 */

type Client = McpPrincipal['supabase'];

const PUBLISH = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .describe('An IANA timezone, e.g. Asia/Kolkata.');

const ReleaseTargetSchema = z.object({
  connectionId: z
    .string()
    .uuid()
    .describe('The channel (list_channels with the projectId).'),
  contentType: z
    .enum(['full', 'short'])
    .describe('full: the episode video. short: a Shorts group’s video.'),
  shortsGroupId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'For a short: the Shorts group. It must be set to go to this channel’s platform. Shorts join the channel’s Shorts queue in the order listed.',
    ),
  title: z.string().min(1).max(5000),
  description: z.string().max(70000).default(''),
  tags: z.array(z.string().min(1).max(100)).max(100).default([]),
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
      'YouTube only. The audience and category default to the channel’s own answer in Settings → Platforms.',
    ),
});

type ReleaseTarget = z.infer<typeof ReleaseTargetSchema>;

/**
 * A long video's thumbnail as the Publish screen picks it: the episode's
 * thumbnail in the video's language, else its default (KB-210's shared
 * resolver). A Short gets none (KB-197), so it is never looked up for one.
 */
async function longVideoThumbnails(
  client: Client,
  episodeId: string,
  targets: ReleaseTarget[],
) {
  const fulls = targets.filter((t) => t.contentType === 'full');
  if (!fulls.length) return new Map<number, string>();

  const [rows, { data: channels }] = await Promise.all([
    readEpisodeThumbnails(client, episodeId).catch(() => {
      throw new McpToolError('INTERNAL', 'Could not read the thumbnails.');
    }),
    client
      .from('platform_connections')
      .select('id, language')
      .in('id', [...new Set(fulls.map((t) => t.connectionId))]),
  ]);

  const chosen = new Map<number, string>();

  targets.forEach((target, index) => {
    if (target.contentType !== 'full') return;

    const language =
      target.language ??
      channels?.find((c) => c.id === target.connectionId)?.language ??
      'en';
    const url = pickEpisodeThumbnail(rows, language);

    if (url) chosen.set(index, url);
  });

  return chosen;
}

/** Each channel's Shorts queue after the release, and a warning when it runs ahead */
function queueLines(queues: readonly ShortsQueueSummary[]) {
  if (!queues.length) return '';

  return `\nShorts queues:\n${queues
    .map(
      (q) =>
        `- ${q.name} (${q.platform}): ${q.queued} queued, the last ${q.lastShortAt}, ${q.daysAhead ?? 0} days past the last long video${q.runsAhead ? ` — more than ${QUEUE_WARNING_DAYS} days: more Shorts per episode than Short slots between long videos` : ''}`,
    )
    .join('\n')}`;
}

/** FILM-2210: the posts a breaking release moves back, and the upload-budget warning */
function breakingLines(
  moves: readonly BreakingMove[],
  quota: ReadonlyArray<{ day: string; uploads: number; limit: number }>,
) {
  const moved = moves.length
    ? `\nMoved back (${moves.length}):\n${moves
        .map(
          (m) =>
            `- ${m.title ?? m.publishId} on ${m.name}: ${m.from} → ${m.to}`,
        )
        .join('\n')}`
    : '\nNothing already scheduled moves.';
  const warned = quota.length
    ? `\nYouTube upload budget (${quota[0]!.limit} a day across the team's channels) passed on ${quota
        .map((q) => `${q.day} (${q.uploads})`)
        .join(
          ', ',
        )}: uploads past it fail until the quota resets at midnight Pacific. A warning; nothing is refused.`
    : '';

  return moved + warned;
}

/** The release's own key for target `index`, echoed back in the plan */
const keyOf = (index: number) => `target-${index}`;
const indexOf = (key: string) => Number(key.replace('target-', ''));

export const scheduleReleaseTool = defineTool({
  name: 'schedule_release',
  title: 'Schedule a release on the channels’ cadence',
  description:
    "Schedules an episode's long video and its Shorts on each channel's posting cadence (get_channel_cadence), as the Publish screen's Schedule Release panel does: the long video takes the channel's next free long-video slot, the channel's days after its last one. Each channel has one Shorts queue, oldest first: this release's Shorts go after every Short already queued there, in the order listed, no earlier than the channel's hours after their long video on that channel, never more a day than its Short times and only on its every-N-days. An episode's Shorts keep posting after the next episode's long video; nothing already scheduled moves, and nothing is held. Each Short waits for its long video to be live. shortsQueue says, per channel, how many Shorts wait, when the last goes and how many days that is past the last long video: runsAhead (over 7 days) means the episodes have more Shorts than Short slots between long videos, so the queue keeps growing. A long video carries the episode's thumbnail for its language (request_episode_thumbnail_upload); Shorts carry none. Call it with preview: true first: it returns where every post would go and writes nothing. Release episodes in order: each goes after the channel's last one. For breaking news, pass `breaking`: the episode goes ahead of the queue instead of after it, and the preview lists the posts it moves back and any YouTube upload-budget warning.",
  inputSchema: {
    episodeId: z.string().uuid(),
    targets: z
      .array(ReleaseTargetSchema)
      .min(1)
      .max(200)
      .describe(
        'One per channel and video: the long video to each long-video channel, each Shorts group to each of its channels.',
      ),
    notBefore: z
      .string()
      .datetime({ offset: true })
      .describe(
        'Nothing goes out before this, ISO 8601 with a time zone. Use it to start one channel a day after another.',
      ),
    timezone: TimeZone.describe(
      'The zone a channel with no cadence of its own posts in.',
    ),
    preview: z
      .boolean()
      .default(false)
      .describe('true: return the plan and write nothing.'),
    aiGenerated: z
      .boolean()
      .default(false)
      .describe(
        'Label the videos as AI-generated on the platforms that have such a label.',
      ),
    breaking: z
      .object({
        at: z
          .string()
          .datetime({ offset: true })
          .optional()
          .describe(
            'When the long video goes, ISO 8601 with a time zone. Left out: the next scheduler run, about 5 minutes away.',
          ),
        boost: z
          .object({
            extraPerDay: z.number().int().min(0).max(4).default(2),
            days: z.number().int().min(1).max(7).default(3),
          })
          .optional()
          .describe(
            'Extra Short times a day on each channel, used only by this release’s Shorts, for this many days. Default 2 a day for 3 days.',
          ),
        startAfterHours: z
          .number()
          .min(0)
          .max(48)
          .optional()
          .describe(
            'Hours after the long video before its first Short. Default 1.',
          ),
      })
      .optional()
      .describe(
        'Breaking news (FILM-2210): the long video goes now (or at `at`) whatever the channel’s long-video spacing, and no scheduled long video moves; its Shorts go to the front of each channel’s Shorts queue with the extra times, and the Shorts already queued move back in order. notBefore is ignored. Preview first and show the person what moves.',
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

    const thumbnails = await longVideoThumbnails(
      client,
      input.episodeId,
      input.targets,
    );

    const release = {
      episodeId: input.episodeId,
      notBefore: new Date(input.notBefore).toISOString(),
      timezone: input.timezone,
      aiGenerated: input.aiGenerated,
      targets: input.targets.map(({ youtube, ...target }, index) => ({
        ...target,
        key: keyOf(index),
        thumbnailUrl: thumbnails.get(index) ?? null,
        platformSpecific: youtube ?? {},
      })),
    };

    const describe = (key: string) => {
      const target = input.targets[indexOf(key)];
      return target
        ? `${target.contentType === 'full' ? 'long video' : `short ${target.shortsGroupId}`} → ${target.connectionId}`
        : key;
    };

    if (input.breaking && input.preview) {
      const result = await previewBreakingRelease(client, {
        ...release,
        breaking: input.breaking,
      });
      if (!result.ok) throw refused(result.refusal, 'targets');

      const { placed, moves, quota, shortsQueue } = result.data;
      const lines = placed.map(
        (p) =>
          `- ${p.scheduledAt}: ${describe(p.key)}${p.extra ? ' (extra time)' : ''}`,
      );

      return {
        text: `Breaking preview, nothing written: ${placed.length} placed.\n${lines.join('\n')}${breakingLines(moves, quota)}`,
        structuredContent: {
          episodeId: input.episodeId,
          preview: true,
          breaking: true,
          placed: placed.map((p) => ({ ...p, target: indexOf(p.key) })),
          moves,
          quota,
          shortsQueue,
        },
      };
    }

    if (input.breaking) {
      const result = await scheduleBreakingRelease(
        client,
        context.principal.userId,
        { ...release, breaking: input.breaking },
      );
      if (!result.ok) throw refused(result.refusal, 'targets');

      const { scheduled, moves, quota, shortsQueue } = result.data;

      return {
        text: `Scheduled breaking release: ${scheduled.length} post${scheduled.length === 1 ? '' : 's'}.\n${scheduled
          .map(
            (row) =>
              `- ${row.scheduledAt}: ${row.platform} ${row.contentType} (${row.language}), publish ${row.publishId}`,
          )
          .join('\n')}${breakingLines(moves, quota)}`,
        structuredContent: {
          episodeId: input.episodeId,
          preview: false,
          breaking: true,
          scheduled,
          moves,
          quota,
          shortsQueue,
        },
      };
    }

    if (input.preview) {
      const result = await previewCadenceRelease(client, release);
      if (!result.ok) throw refused(result.refusal, 'targets');

      const { placed, channels, shortsQueue } = result.data;
      const lines = placed.map((p) => `- ${p.scheduledAt}: ${describe(p.key)}`);

      return {
        text: `Preview, nothing written: ${placed.length} placed.\n${lines.join('\n')}${queueLines(shortsQueue)}`,
        structuredContent: {
          episodeId: input.episodeId,
          preview: true,
          placed: placed.map((p) => ({ ...p, target: indexOf(p.key) })),
          channels,
          shortsQueue,
        },
      };
    }

    const result = await scheduleCadenceRelease(
      client,
      context.principal.userId,
      release,
    );
    if (!result.ok) throw refused(result.refusal, 'targets');

    const { scheduled, shortsQueue } = result.data;

    return {
      text: `Scheduled ${scheduled.length} post${scheduled.length === 1 ? '' : 's'}.\n${scheduled
        .map(
          (row) =>
            `- ${row.scheduledAt}: ${row.platform} ${row.contentType} (${row.language}), publish ${row.publishId}`,
        )
        .join('\n')}${queueLines(shortsQueue)}`,
      structuredContent: {
        episodeId: input.episodeId,
        preview: false,
        scheduled,
        shortsQueue,
      },
    };
  },
});

/** The channels of the bound team only, on top of RLS */
async function requireChannelsInAccount(
  client: Client,
  accountId: string,
  connectionIds: string[],
) {
  const { data, error } = await client
    .from('platform_connections')
    .select('id, platform, platform_account_name')
    .in('id', connectionIds)
    .eq('account_id', accountId);

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the channels.');
  }

  const missing = connectionIds.filter(
    (id) => !data?.some((row) => row.id === id),
  );

  if (missing.length) {
    throw new McpToolError(
      'NOT_FOUND',
      'No channel with this id in your team.',
      {
        details: { connectionIds: missing },
      },
    );
  }

  return data ?? [];
}

export const getChannelCadenceTool = defineTool({
  name: 'get_channel_cadence',
  title: 'Read channels’ posting cadence',
  description:
    "Each channel's posting cadence for long videos (full) and Shorts (short): the times of day it posts in its timezone (their count is how many it posts a day), the weekdays, a long video every minDaysBetween days, Shorts on every everyNDays-th day, the hours Shorts wait after their long video, and the random minutes added to each time. own: false means the channel posts on the defaults.",
  inputSchema: {
    connectionIds: z.array(z.string().uuid()).min(1).max(100),
  },
  scope: 'studio:read',
  annotations: READ,
  async handler(input, context) {
    const client = context.principal.supabase;
    const channels = await requireChannelsInAccount(
      client,
      context.accountId,
      input.connectionIds,
    );
    const cadences = await readChannelCadences(client, input.connectionIds);

    const named = cadences.map((row) => {
      const channel = channels.find((c) => c.id === row.connectionId);
      return {
        ...row,
        platform: channel?.platform ?? null,
        name: channel?.platform_account_name ?? null,
      };
    });

    return {
      text: named
        .map(
          (row) =>
            `- ${row.name ?? row.connectionId} (${row.platform}) ${row.contentType}: ${row.cadence.slotTimes.join(', ')}${row.own ? '' : ' (defaults)'}`,
        )
        .join('\n'),
      structuredContent: { cadences: named },
    };
  },
});

export const setChannelCadenceTool = defineTool({
  name: 'set_channel_cadence',
  title: 'Set a channel’s posting cadence',
  description:
    "Sets one channel's posting cadence for long videos (full) or Shorts (short), as the Publish screen's cadence dialog does. It applies to releases scheduled after it (schedule_release); posts already scheduled keep their times.",
  inputSchema: {
    connectionId: z.string().uuid(),
    contentType: z.enum(['full', 'short']),
    timezone: TimeZone,
    slotTimes: z
      .array(z.string())
      .min(1)
      .max(6)
      .describe(
        'Times of day as HH:MM in the timezone, e.g. ["11:00", "17:00"]; their count is how many it posts of this type in a day (2 Shorts a day for two times).',
      ),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .default([0, 1, 2, 3, 4, 5, 6])
      .describe('0 = Sunday … 6 = Saturday.'),
    minDaysBetween: z
      .number()
      .int()
      .min(0)
      .max(30)
      .default(0)
      .describe(
        'Long videos: a long video every this many days (local calendar days).',
      ),
    everyNDays: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(1)
      .describe(
        'Shorts: post on every Nth day (1 every day, 2 every other day), counted from the channel’s Shorts queue; long videos keep 1.',
      ),
    startAfterHours: z
      .number()
      .int()
      .min(0)
      .max(168)
      .default(2)
      .describe(
        'Shorts: hours after their long video on the channel before the first goes.',
      ),
    jitterMinutes: z
      .number()
      .int()
      .min(0)
      .max(120)
      .default(15)
      .describe('± this many random minutes on each post.'),
    enabled: z.boolean().default(true),
  },
  scope: 'studio:publish',
  annotations: { ...PUBLISH, idempotentHint: true, openWorldHint: false },
  async handler(input, context) {
    const client = context.principal.supabase;
    await requireChannelsInAccount(client, context.accountId, [
      input.connectionId,
    ]);

    // The dialog's own rules: slot format, a valid zone, each time once
    const parsed = ChannelCadenceSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw refused(
        issue?.message ?? 'The cadence was refused.',
        String(issue?.path[0] ?? ''),
      );
    }

    const result = await saveChannelCadence(client, parsed.data);
    if (!result.ok) throw refused(result.refusal, 'connectionId');

    return {
      text: `The channel's ${input.contentType === 'full' ? 'long-video' : 'Shorts'} cadence is ${parsed.data.slotTimes.join(', ')} (${parsed.data.timezone})${input.contentType === 'full' ? `, every ${parsed.data.minDaysBetween} days` : `, every ${parsed.data.everyNDays === 1 ? 'day' : `${parsed.data.everyNDays} days`}`}.`,
      structuredContent: { ...result.data, cadence: parsed.data },
    };
  },
});

/** Held Shorts of the bound team only: their episodes are checked */
async function requireHeldInAccount(
  client: Client,
  accountId: string,
  publishIds: string[],
) {
  const { data, error } = await client
    .from('publishes')
    .select('id, episode_id')
    .in('id', publishIds);

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the publishes.');
  }

  const found = data ?? [];
  const missing = publishIds.filter((id) => !found.some((r) => r.id === id));
  if (missing.length) {
    throw new McpToolError('NOT_FOUND', 'Publish record not found', {
      details: { publishIds: missing },
    });
  }

  for (const episodeId of new Set(found.map((r) => r.episode_id))) {
    await requireEpisodeInAccount(client, accountId, episodeId, 'id');
  }
}

const HeldIds = z
  .array(z.string().uuid())
  .min(1)
  .max(200)
  .describe('Held Shorts: get_publish_calendar lists them with status held.');

export const requeueHeldShortsTool = defineTool({
  name: 'requeue_held_shorts',
  title: 'Re-queue held Shorts',
  description:
    'Puts Shorts an earlier release held (before FILM-2209 a new long video held its predecessor’s Shorts) at the end of their channels’ Shorts queues, still waiting for their long video. A release no longer holds Shorts, so this is only for those older drafts.',
  inputSchema: { publishIds: HeldIds, timezone: TimeZone },
  scope: 'studio:publish',
  annotations: PUBLISH,
  async handler(input, context) {
    const client = context.principal.supabase;
    await requireHeldInAccount(client, context.accountId, input.publishIds);

    const result = await requeueHeldShorts(client, input);
    if (!result.ok) throw refused(result.refusal, 'publishIds');

    return {
      text: `Re-queued ${result.data.requeued.length}.`,
      structuredContent: result.data,
    };
  },
});

export const discardHeldShortsTool = defineTool({
  name: 'discard_held_shorts',
  title: 'Discard held Shorts',
  description:
    'Deletes held Shorts that will not be posted. Only held drafts are removed; a scheduled or published post is left alone.',
  inputSchema: { publishIds: HeldIds },
  scope: 'studio:publish',
  annotations: { ...PUBLISH, destructiveHint: true, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;
    await requireHeldInAccount(client, context.accountId, input.publishIds);

    const result = await discardHeldShorts(client, input.publishIds);
    if (!result.ok) throw refused(result.refusal, 'publishIds');

    return {
      text: `Discarded ${result.data.discarded.length} held Short${result.data.discarded.length === 1 ? '' : 's'}.`,
      structuredContent: result.data,
    };
  },
});

export const getPublishCalendarTool = defineTool({
  name: 'get_publish_calendar',
  title: 'Read a project’s publishing calendar',
  description:
    'Every post of one project between from and to (at most 62 days), across its episodes and channels, in time order: what went out (with its link), what is scheduled, what failed and why, and any Shorts an earlier release held (status held, with the reason; requeue_held_shorts or discard_held_shorts). For a daily report, ask for yesterday to a few days ahead.',
  inputSchema: {
    projectId: z.string().uuid(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  },
  scope: 'studio:read',
  annotations: READ,
  async handler(input, context) {
    const client = context.principal.supabase;
    await requireProjectInAccount(client, context.accountId, input.projectId);

    const from = new Date(input.from);
    const to = new Date(input.to);
    const days = (to.getTime() - from.getTime()) / 86_400_000;

    if (days <= 0 || days > MAX_CALENDAR_DAYS) {
      throw refused(
        `to must be after from, and at most ${MAX_CALENDAR_DAYS} days later.`,
        'to',
      );
    }

    const posts = await readPublishCalendar(client, {
      projectId: input.projectId,
      from,
      to,
    });

    const count = (status: string) =>
      posts.filter((p) => p.status === status).length;

    return {
      text: `${posts.length} posts: ${count('published')} published, ${count('scheduled')} scheduled, ${count('failed')} failed, ${count('held')} held.`,
      structuredContent: { projectId: input.projectId, posts },
    };
  },
});

export const releaseTools = [
  scheduleReleaseTool,
  getChannelCadenceTool,
  setChannelCadenceTool,
  requeueHeldShortsTool,
  discardHeldShortsTool,
  getPublishCalendarTool,
] as unknown as McpToolDefinition[];
