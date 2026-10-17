import 'server-only';

import { z } from 'zod';

import { SUPPORTED_LANGUAGES } from '@kit/publishing/lib/constants';
import { ChannelCadenceSchema } from '@kit/publishing/lib/schemas/schedule-release';
import {
  discardHeldShorts,
  previewCadenceRelease,
  readChannelCadences,
  requeueHeldShorts,
  saveChannelCadence,
  scheduleCadenceRelease,
} from '@kit/publishing/server/schedule-release';
import { fetchAllRows } from '@kit/shared/pagination';

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
 * free slot, its Shorts a slot at a time until the next episode's long
 * video, each Short waiting for its long video to go out. Every tool calls
 * the function the Publish screen calls.
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
      'For a short: the Shorts group. It must be set to go to this channel’s platform. Shorts are placed in the order listed.',
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

interface ThumbnailRow {
  language: string;
  thumbnail_url: string;
  is_default: boolean | null;
}

/**
 * A long video's thumbnail as the Publish screen picks it: the episode's
 * thumbnail in the video's language, else its default. A Short gets none
 * (KB-197), so it is never looked up for one.
 */
async function longVideoThumbnails(
  client: Client,
  episodeId: string,
  targets: ReleaseTarget[],
) {
  const fulls = targets.filter((t) => t.contentType === 'full');
  if (!fulls.length) return new Map<number, string>();

  const [{ data: thumbnails, error }, { data: channels }] = await Promise.all([
    client
      .from('episode_thumbnails')
      .select('language, thumbnail_url, is_default')
      .eq('episode_id', episodeId),
    client
      .from('platform_connections')
      .select('id, language')
      .in('id', [...new Set(fulls.map((t) => t.connectionId))]),
  ]);

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the thumbnails.');
  }

  const rows = (thumbnails ?? []) as ThumbnailRow[];
  const fallback = rows.find((row) => row.is_default)?.thumbnail_url;
  const chosen = new Map<number, string>();

  targets.forEach((target, index) => {
    if (target.contentType !== 'full') return;

    const language =
      target.language ??
      channels?.find((c) => c.id === target.connectionId)?.language ??
      'en';
    const url =
      rows.find((row) => row.language === language)?.thumbnail_url ?? fallback;

    if (url) chosen.set(index, url);
  });

  return chosen;
}

/** The release's own key for target `index`, echoed back in the plan */
const keyOf = (index: number) => `target-${index}`;
const indexOf = (key: string) => Number(key.replace('target-', ''));

export const scheduleReleaseTool = defineTool({
  name: 'schedule_release',
  title: 'Schedule a release on the channels’ cadence',
  description:
    "Schedules an episode's long video and its Shorts on each channel's posting cadence (get_channel_cadence), as the Publish screen's Schedule Release panel does: the long video takes the channel's next free long-video slot, at least the channel's days after its last one; the Shorts take one Short slot at a time after it, in the order listed, only until the next episode's long video, and each waits for its long video to be live. Shorts that do not fit are held as drafts (requeue_held_shorts, discard_held_shorts); this release's long video holds an earlier episode's Shorts still scheduled after it. A long video carries the episode's thumbnail for its language (request_episode_thumbnail_upload); Shorts carry none. Call it with preview: true first: it returns where every post would go and writes nothing. Release an episode's predecessors first: each long video goes after the channel's last one.",
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

    if (input.preview) {
      const result = await previewCadenceRelease(client, release);
      if (!result.ok) throw refused(result.refusal, 'targets');

      const { placed, held, displaced, channels } = result.data;
      const lines = [
        ...placed.map((p) => `- ${p.scheduledAt}: ${describe(p.key)}`),
        ...held.map((h) => `- held (${h.reason}): ${describe(h.key)}`),
      ];

      return {
        text: `Preview, nothing written: ${placed.length} placed, ${held.length} held, ${displaced.length} of an earlier episode's Shorts held back.\n${lines.join('\n')}`,
        structuredContent: {
          episodeId: input.episodeId,
          preview: true,
          placed: placed.map((p) => ({ ...p, target: indexOf(p.key) })),
          held: held.map((h) => ({ ...h, target: indexOf(h.key) })),
          displaced,
          channels,
        },
      };
    }

    const result = await scheduleCadenceRelease(
      client,
      context.principal.userId,
      release,
    );
    if (!result.ok) throw refused(result.refusal, 'targets');

    const { scheduled, held, displaced } = result.data;

    return {
      text: `Scheduled ${scheduled.length} post${scheduled.length === 1 ? '' : 's'}, held ${held.length}, held back ${displaced.length} of an earlier episode's Shorts.\n${scheduled
        .map(
          (row) =>
            `- ${row.scheduledAt ?? 'held'}: ${row.platform} ${row.contentType} (${row.language}), publish ${row.publishId}`,
        )
        .join('\n')}`,
      structuredContent: {
        episodeId: input.episodeId,
        preview: false,
        scheduled,
        held: held.map((h) => ({ ...h, target: indexOf(h.key) })),
        displaced,
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
    "Each channel's posting cadence for long videos (full) and Shorts (short): the times of day it posts in its timezone (their count is its daily cap), the weekdays, the days between long videos, the hours Shorts wait after their long video, and the random minutes added to each time. own: false means the channel posts on the defaults.",
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
        'Times of day as HH:MM in the timezone, e.g. ["11:00", "21:00"]; their count is the most it posts of this type in a day.',
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
      .describe('Long videos: the least days between two on the channel.'),
    startAfterHours: z
      .number()
      .int()
      .min(0)
      .max(168)
      .default(0)
      .describe('Shorts: hours after their long video before the first goes.'),
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
      text: `The channel's ${input.contentType === 'full' ? 'long-video' : 'Shorts'} cadence is ${parsed.data.slotTimes.join(', ')} (${parsed.data.timezone}).`,
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
    'Puts held Shorts back on their channels, each in the next free Short slot after everything already scheduled there, still waiting for their long video. One that still finds no slot stays held.',
  inputSchema: { publishIds: HeldIds, timezone: TimeZone },
  scope: 'studio:publish',
  annotations: PUBLISH,
  async handler(input, context) {
    const client = context.principal.supabase;
    await requireHeldInAccount(client, context.accountId, input.publishIds);

    const result = await requeueHeldShorts(client, input);
    if (!result.ok) throw refused(result.refusal, 'publishIds');

    return {
      text: `Re-queued ${result.data.requeued.length}; ${result.data.stillHeld.length} still held.`,
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

const MAX_CALENDAR_DAYS = 62;

const CALENDAR_COLUMNS =
  'id, episode_id, platform, platform_connection_id, content_type, language, title, status, scheduled_at, slot_at, published_at, created_at, platform_url, metadata, episodes!inner(title, number, project_id)';

type CalendarPage = PromiseLike<{
  data: CalendarPublish[] | null;
  error: { message: string } | null;
}>;

interface CalendarPublish {
  id: string;
  episode_id: string;
  platform: string;
  platform_connection_id: string | null;
  content_type: string;
  language: string | null;
  title: string | null;
  status: string;
  scheduled_at: string | null;
  slot_at: string | null;
  published_at: string | null;
  created_at: string;
  platform_url: string | null;
  metadata: unknown;
  episodes: { title: string | null; number: number | null };
}

/** When a post goes, or went, out; else when it was made (a failed Publish Now, a held draft) */
function postTime(row: CalendarPublish) {
  return row.published_at ?? row.scheduled_at ?? row.slot_at ?? row.created_at;
}

export const getPublishCalendarTool = defineTool({
  name: 'get_publish_calendar',
  title: 'Read a project’s publishing calendar',
  description:
    'Every post of one project between from and to (at most 62 days), across its episodes and channels, in time order: what went out (with its link), what is scheduled, what failed and why, and the held Shorts (status held, with the reason) that no slot was found for. For a daily report, ask for yesterday to a few days ahead.',
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

    const [f, t] = [from.toISOString(), to.toISOString()];
    // Gone out in range; else due in range; else, with neither time, made in range
    const range = [
      `and(published_at.gte.${f},published_at.lte.${t})`,
      `and(published_at.is.null,scheduled_at.gte.${f},scheduled_at.lte.${t})`,
      `and(published_at.is.null,scheduled_at.is.null,created_at.gte.${f},created_at.lte.${t})`,
    ].join(',');

    const [dated, held] = await Promise.all([
      fetchAllRows<CalendarPublish>(
        (start, end) =>
          client
            .from('publishes')
            .select(CALENDAR_COLUMNS)
            .eq('episodes.project_id', input.projectId)
            .neq('status', 'deleted')
            .or(range)
            .order('id')
            .range(start, end) as unknown as CalendarPage,
        'publish calendar',
      ),
      // Held Shorts have no time: listed whatever the range
      fetchAllRows<CalendarPublish>(
        (start, end) =>
          client
            .from('publishes')
            .select(CALENDAR_COLUMNS)
            .eq('episodes.project_id', input.projectId)
            .eq('status', 'draft')
            .not('metadata->heldReason', 'is', null)
            .order('id')
            .range(start, end) as unknown as CalendarPage,
        'held shorts',
      ),
    ]);

    // A held draft made in the range comes back from both reads
    const byId = new Map([...dated, ...held].map((row) => [row.id, row]));

    const posts = [...byId.values()].map((row) => {
      const metadata = (row.metadata ?? {}) as {
        heldReason?: string;
        error?: string;
      };
      const isHeld = row.status === 'draft' && !!metadata.heldReason;

      return {
        publishId: row.id,
        episodeId: row.episode_id,
        episodeTitle: row.episodes.title,
        episodeNumber: row.episodes.number,
        platform: row.platform,
        connectionId: row.platform_connection_id,
        contentType: row.content_type,
        language: row.language,
        title: row.title,
        status: isHeld ? 'held' : row.status,
        // A held Short has no time until it is re-queued: listed last
        at: isHeld ? null : postTime(row),
        platformUrl: row.platform_url,
        error: row.status === 'failed' ? (metadata.error ?? null) : null,
        heldReason: isHeld ? metadata.heldReason : null,
      };
    });

    posts.sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9'));

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
