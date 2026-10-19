import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import { fetchAllByIds } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import {
  DEFAULT_CADENCE,
  HORIZON_DAYS,
  resolveCadence,
} from '../lib/cadence/cadence';
import {
  BREAKING_DEFAULTS,
  type BreakingPlan,
  type QuotaDay,
  planBreakingRelease,
  youtubeDailyUploadWarnAt,
  youtubeQuotaWarnings,
} from '../lib/cadence/plan-breaking-release';
import {
  type EpisodeAnchor,
  type OccupiedPost,
  type ReleaseItem,
  type ReleasePlan,
  planRelease,
} from '../lib/cadence/plan-release';
import {
  type BreakingMove,
  type BreakingPreview,
  QUEUE_WARNING_DAYS,
  type ReleasePreview,
} from '../lib/cadence/release-types';
import type {
  BreakingInput,
  ChannelCadenceInput,
} from '../lib/schemas/schedule-release.schema';
import {
  CALENDAR_COLUMNS,
  type CalendarRow,
  ON_CALENDAR,
  cadenceOfRows,
  contentTypeOf,
  postTime,
  readCadences,
  readCalendar,
} from './channel-calendar';
import { assertConnectionOfProject } from './project-channels';
import {
  type ScheduleTarget,
  type ScheduledPublish,
  SlotTaken,
  insertScheduledRows,
  prepareScheduledRows,
} from './schedule-publishes.service';

/**
 * FILM-719, FILM-2209. A release scheduled on its channels' cadence: the
 * long video in the channel's next free slot after its last one, and its
 * Shorts at the end of each channel's Shorts queue, oldest first, never
 * more a day than the channel's slots.
 *
 * Reads every post on the release's channels (paged: the 1000-row cap is
 * silent), plans with planRelease, and writes the release through the same
 * preparePublish the Publish screen runs. Nothing already scheduled moves.
 * A slot another release took in the meantime fails the insert on
 * `publishes_channel_slot_key`; the release is planned again once.
 */

type Client = SupabaseClient<Database>;

type Result<T> = { ok: true; data: T } | { ok: false; refusal: string };

/** One upload of the release, without a time: the cadence picks it */
export interface CadenceTarget
  extends Omit<ScheduleTarget, 'scheduledAt' | 'slotAt'> {
  /** The caller's name for it, echoed in the plan */
  key: string;
}

export interface ReleaseInput {
  episodeId: string;
  targets: CadenceTarget[];
  /** The long video goes no earlier than this */
  notBefore: string;
  /** The zone a channel with no cadence of its own posts in */
  timezone: string;
  aiGenerated: boolean;
  /**
   * KB-204, previews only: the episode's long video goes out at this time
   * (Publish video now), so its Shorts are shown waiting for it
   */
  longGoesAt?: string;
}

/**
 * When each episode's long videos go (or went) out: the earliest anywhere,
 * and the earliest on each channel, which that channel's Shorts wait for
 */
async function readAnchors(client: Client, episodeIds: string[]) {
  const rows = await fetchAllByIds<CalendarRow>(
    episodeIds,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select(CALENDAR_COLUMNS)
        .in('episode_id', chunk)
        .eq('content_type', 'full')
        .in('status', [...ON_CALENDAR, 'published'])
        .order('id')
        .range(from, to),
    'episode long videos',
  );

  const anchors = new Map<
    string,
    { earliest: Date; byChannel: Map<string, Date> }
  >();

  for (const row of rows) {
    const at = postTime(row);
    if (!at) continue;

    const anchor = anchors.get(row.episode_id) ?? {
      earliest: at,
      byChannel: new Map<string, Date>(),
    };
    if (at < anchor.earliest) anchor.earliest = at;

    const channel = row.platform_connection_id;
    const onChannel = channel ? anchor.byChannel.get(channel) : undefined;
    if (channel && (!onChannel || at < onChannel)) {
      anchor.byChannel.set(channel, at);
    }

    anchors.set(row.episode_id, anchor);
  }

  return anchors as Map<string, EpisodeAnchor>;
}

async function readChannels(client: Client, connectionIds: string[]) {
  const { data, error } = await client
    .from('platform_connections')
    .select('id, platform, platform_account_name')
    .in('id', connectionIds);

  if (error) {
    throw new Error(`Could not read the channels: ${error.message}`);
  }

  if (data.length !== connectionIds.length) {
    throw new ActionRefusal(
      'That channel is not one of this team’s. Choose the project’s channels.',
    );
  }

  return data;
}

interface PlanContext {
  plan: ReleasePlan;
  channels: Awaited<ReturnType<typeof readChannels>>;
}

async function planFor(
  client: Client,
  input: {
    episodeId: string;
    items: ReleaseItem[];
    notBefore: Date;
    timezone: string;
    now: Date;
    random: () => number;
    longGoesAt?: Date;
  },
): Promise<PlanContext> {
  const connectionIds = [...new Set(input.items.map((i) => i.connectionId))];

  const [channels, cadences, occupied] = await Promise.all([
    readChannels(client, connectionIds),
    readCadences(client, connectionIds),
    readCalendar(client, connectionIds, input.now),
  ]);

  const anchors = await readAnchors(client, [
    input.episodeId,
    ...occupied.map((post) => post.episodeId),
  ]);

  if (input.longGoesAt && !anchors.has(input.episodeId)) {
    anchors.set(input.episodeId, {
      earliest: input.longGoesAt,
      byChannel: new Map(),
    });
  }

  const plan = planRelease({
    episodeId: input.episodeId,
    notBefore: input.notBefore,
    items: input.items,
    cadenceOf: cadenceOfRows(cadences, input.timezone),
    occupied,
    anchors,
    now: input.now,
    random: input.random,
  });

  refuseUnplaced(plan, channels);

  return { plan, channels };
}

function refuseUnplaced(
  plan: Pick<ReleasePlan, 'unplaced'>,
  channels: Awaited<ReturnType<typeof readChannels>>,
) {
  if (plan.unplaced.length) {
    const names = [
      ...new Set(
        plan.unplaced.map(
          (item) =>
            channels.find((c) => c.id === item.connectionId)
              ?.platform_account_name ?? 'a channel',
        ),
      ),
    ];

    throw new ActionRefusal(
      `No free slot in the next ${HORIZON_DAYS} days for ${plan.unplaced.length} upload${plan.unplaced.length === 1 ? '' : 's'} on ${names.join(', ')}. Add posting times or days to its posting rules.`,
    );
  }
}

function previewOf({ plan, channels }: PlanContext): ReleasePreview {
  const named = (connectionId: string) => {
    const channel = channels.find((c) => c.id === connectionId);

    return {
      name: channel?.platform_account_name ?? 'Channel',
      platform: channel?.platform ?? '',
    };
  };

  return {
    placed: plan.placed.map((item) => ({
      key: item.key,
      connectionId: item.connectionId,
      contentType: item.contentType,
      scheduledAt: item.scheduledAt.toISOString(),
    })),
    channels: plan.channels.map((summary) => ({
      connectionId: summary.connectionId,
      ...named(summary.connectionId),
      queueEndsAt: summary.queueEndsAt?.toISOString() ?? null,
    })),
    shortsQueue: plan.shortsQueues
      .filter((queue) => queue.queued > 0)
      .map((queue) => ({
        connectionId: queue.connectionId,
        ...named(queue.connectionId),
        queued: queue.queued,
        lastShortAt: queue.lastShortAt?.toISOString() ?? null,
        longVideosEndAt: queue.longVideosEndAt?.toISOString() ?? null,
        daysAhead: queue.daysAhead,
        runsAhead: (queue.daysAhead ?? 0) > QUEUE_WARNING_DAYS,
      })),
  };
}

function itemsOf(targets: CadenceTarget[]): ReleaseItem[] {
  const keys = new Set<string>();

  return targets.map((target) => {
    if (keys.has(target.key)) {
      throw new ActionRefusal('Each upload in a release is listed once.');
    }
    keys.add(target.key);

    return {
      key: target.key,
      connectionId: target.connectionId,
      contentType: target.contentType,
    };
  });
}

function refused<T>(error: unknown): Result<T> {
  if (error instanceof ActionRefusal) {
    return { ok: false, refusal: error.message };
  }

  throw error;
}

/**
 * A preview refuses a channel outside the episode's project, as scheduling
 * does at preflight, so a preview never shows posts that cannot be made
 * (KB-199: `list_channels(projectId)` lists exactly the channels accepted).
 */
async function refuseOutsideProject(
  client: Client,
  episodeId: string,
  items: ReleaseItem[],
) {
  const { data: episode, error } = await client
    .from('episodes')
    .select('project_id')
    .eq('id', episodeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the episode: ${error.message}`);
  }
  if (!episode) {
    throw new ActionRefusal('That episode was not found.');
  }

  await assertConnectionOfProject(
    client,
    items.map((item) => item.connectionId),
    episode.project_id,
  );
}

/** Where the release would go: nothing is written */
export async function previewCadenceRelease(
  client: Client,
  input: ReleaseInput,
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<ReleasePreview>> {
  try {
    await refuseOutsideProject(client, input.episodeId, itemsOf(input.targets));
    const context = await planFor(client, {
      episodeId: input.episodeId,
      items: itemsOf(input.targets),
      notBefore: new Date(input.notBefore),
      timezone: input.timezone,
      now: options.now ?? new Date(),
      // The preview shows slots; the jitter is drawn when it is scheduled
      random: () => 0.5,
      longGoesAt: input.longGoesAt ? new Date(input.longGoesAt) : undefined,
    });

    return { ok: true, data: previewOf(context) };
  } catch (error) {
    return refused(error);
  }
}

export interface ScheduledRelease {
  scheduled: ScheduledPublish[];
  shortsQueue: ReleasePreview['shortsQueue'];
}

export async function scheduleCadenceRelease(
  client: Client,
  userId: string,
  input: ReleaseInput,
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<ScheduledRelease>> {
  try {
    return {
      ok: true,
      data: await scheduleRelease(client, userId, input, options),
    };
  } catch (error) {
    return refused(error);
  }
}

async function scheduleRelease(
  client: Client,
  userId: string,
  input: ReleaseInput,
  options: { now?: Date; random?: () => number },
): Promise<ScheduledRelease> {
  const items = itemsOf(input.targets);
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    const now = options.now ?? new Date();
    const context = await planFor(client, {
      episodeId: input.episodeId,
      items,
      notBefore: new Date(input.notBefore),
      timezone: input.timezone,
      now,
      random,
    });
    const { plan } = context;

    const targets: ScheduleTarget[] = input.targets.map(
      ({ key, ...target }) => {
        const placed = plan.placed.find((item) => item.key === key)!;

        return {
          ...target,
          scheduledAt: placed.scheduledAt.toISOString(),
          slotAt: placed.slotAt.toISOString(),
          afterEpisodeFull: placed.afterEpisodeFull,
        };
      },
    );

    // Every target is checked before anything is written
    const rows = await prepareScheduledRows(client, userId, {
      episodeId: input.episodeId,
      targets,
      aiGenerated: input.aiGenerated,
      now,
      via: 'cadence',
    });

    try {
      const scheduled = await insertScheduledRows(client, rows);

      return { scheduled, shortsQueue: previewOf(context).shortsQueue };
    } catch (error) {
      if (error instanceof SlotTaken && attempt < 2) continue;

      if (error instanceof SlotTaken) {
        throw new ActionRefusal(
          'Another release took these slots while this one was planned. Try again.',
        );
      }

      throw error;
    }
  }
}

/**
 * FILM-2210. A breaking-news release: the long video at the next scheduler
 * run (or `breaking.at`), its Shorts at the front of each channel's Shorts
 * queue with extra times for a few days, and the normal Shorts behind them
 * moved back in order (planBreakingRelease). The new posts and the moves
 * are written together by reschedule_publishes, all or nothing; a calendar
 * that changed meanwhile is planned again once.
 */
export interface BreakingReleaseInput extends ReleaseInput {
  breaking: BreakingInput;
}

interface BreakingContext {
  plan: BreakingPlan;
  channels: Awaited<ReturnType<typeof readChannels>>;
  occupied: OccupiedPost[];
}

async function planBreakingFor(
  client: Client,
  input: {
    episodeId: string;
    items: ReleaseItem[];
    breaking: BreakingInput;
    timezone: string;
    now: Date;
    random: () => number;
  },
): Promise<BreakingContext> {
  const connectionIds = [...new Set(input.items.map((i) => i.connectionId))];

  const [channels, cadences, occupied] = await Promise.all([
    readChannels(client, connectionIds),
    readCadences(client, connectionIds),
    readCalendar(client, connectionIds, input.now),
  ]);

  const anchors = await readAnchors(client, [
    input.episodeId,
    ...occupied.map((post) => post.episodeId),
  ]);

  const plan = planBreakingRelease({
    episodeId: input.episodeId,
    at: input.breaking.at ? new Date(input.breaking.at) : null,
    boost: input.breaking.boost ?? { ...BREAKING_DEFAULTS.boost },
    startAfterHours:
      input.breaking.startAfterHours ?? BREAKING_DEFAULTS.startAfterHours,
    items: input.items,
    cadenceOf: cadenceOfRows(cadences, input.timezone),
    occupied,
    anchors,
    now: input.now,
    random: input.random,
  });

  refuseUnplaced(plan, channels);

  return { plan, channels, occupied };
}

/** QUOTA_LOOKBACK: a published upload still counts for its Pacific day */
const QUOTA_LOOKBACK_MS = 86_400_000;

/**
 * YouTube uploads a day across the team's YouTube channels once the plan
 * is written: every post not yet out (with its move), the day's published
 * ones, and the release's own
 */
async function quotaWarnings(
  client: Client,
  context: BreakingContext,
  now: Date,
): Promise<QuotaDay[]> {
  const releaseChannels = context.channels.map((c) => c.id);
  const { data: owner, error: ownerError } = await client
    .from('platform_connections')
    .select('account_id')
    .in('id', releaseChannels)
    .limit(1)
    .maybeSingle();

  if (ownerError || !owner) {
    throw new Error(
      `Could not read the team's channels: ${ownerError?.message ?? 'none'}`,
    );
  }

  const { data: youtube, error } = await client
    .from('platform_connections')
    .select('id')
    .eq('account_id', owner.account_id)
    .eq('platform', 'youtube');

  if (error) {
    throw new Error(`Could not read the team's channels: ${error.message}`);
  }

  const ids = youtube.map((c) => c.id);
  if (ids.length === 0) return [];

  const since = new Date(now.getTime() - QUOTA_LOOKBACK_MS);
  const posts = await readCalendar(client, ids, now);
  const moved = new Map(
    context.plan.moves.map((m) => [m.publishId, m.scheduledAt]),
  );

  return youtubeQuotaWarnings(
    [
      ...posts
        .filter((p) => p.goesAt >= since)
        .map((p) => moved.get(p.publishId) ?? p.goesAt),
      ...context.plan.placed
        .filter((p) => ids.includes(p.connectionId))
        .map((p) => p.scheduledAt),
    ],
    youtubeDailyUploadWarnAt(process.env.YOUTUBE_DAILY_UPLOAD_WARN),
  );
}

async function breakingPreviewOf(
  client: Client,
  context: BreakingContext,
  now: Date,
): Promise<BreakingPreview> {
  const { plan, channels } = context;
  const named = (connectionId: string) => {
    const channel = channels.find((c) => c.id === connectionId);

    return {
      name: channel?.platform_account_name ?? 'Channel',
      platform: channel?.platform ?? '',
    };
  };

  const titles = await fetchAllByIds<{ id: string; title: string | null }>(
    plan.moves.map((m) => m.publishId),
    (chunk, from, to) =>
      client
        .from('publishes')
        .select('id, title')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'moved posts',
  );

  const iso = (at: Date | null) => at?.toISOString() ?? null;

  return {
    placed: plan.placed.map((item) => ({
      key: item.key,
      connectionId: item.connectionId,
      ...named(item.connectionId),
      contentType: item.contentType,
      scheduledAt: item.scheduledAt.toISOString(),
      extra: item.extra,
    })),
    moves: plan.moves.map((m) => ({
      publishId: m.publishId,
      connectionId: m.connectionId,
      ...named(m.connectionId),
      title: titles.find((t) => t.id === m.publishId)?.title ?? null,
      from: m.fromScheduledAt.toISOString(),
      to: m.scheduledAt.toISOString(),
    })),
    shortsQueue: plan.queues
      .filter((q) => q.after.queued > 0)
      .map((q) => ({
        connectionId: q.connectionId,
        ...named(q.connectionId),
        before: {
          queued: q.before.queued,
          lastShortAt: iso(q.before.lastShortAt),
        },
        after: {
          queued: q.after.queued,
          lastShortAt: iso(q.after.lastShortAt),
        },
      })),
    quota: await quotaWarnings(client, context, now),
  };
}

/** Where a breaking release would go, and what it moves: nothing is written */
export async function previewBreakingRelease(
  client: Client,
  input: BreakingReleaseInput,
  options: { now?: Date } = {},
): Promise<Result<BreakingPreview>> {
  try {
    await refuseOutsideProject(client, input.episodeId, itemsOf(input.targets));

    const now = options.now ?? new Date();
    const context = await planBreakingFor(client, {
      episodeId: input.episodeId,
      items: itemsOf(input.targets),
      breaking: input.breaking,
      timezone: input.timezone,
      now,
      random: () => 0.5,
    });

    return { ok: true, data: await breakingPreviewOf(client, context, now) };
  } catch (error) {
    return refused(error);
  }
}

export interface ScheduledBreakingRelease {
  scheduled: ScheduledPublish[];
  moves: BreakingMove[];
  shortsQueue: BreakingPreview['shortsQueue'];
  quota: QuotaDay[];
}

/** The calendar changed between planning and writing: a slot was taken, or a post claimed */
const CALENDAR_CHANGED = new Set(['23505', '55000']);

export async function scheduleBreakingRelease(
  client: Client,
  userId: string,
  input: BreakingReleaseInput,
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<ScheduledBreakingRelease>> {
  try {
    const items = itemsOf(input.targets);
    const random = options.random ?? Math.random;

    for (let attempt = 1; ; attempt++) {
      const now = options.now ?? new Date();
      const context = await planBreakingFor(client, {
        episodeId: input.episodeId,
        items,
        breaking: input.breaking,
        timezone: input.timezone,
        now,
        random,
      });
      const { plan } = context;

      const targets: ScheduleTarget[] = input.targets.map(
        ({ key, ...target }) => {
          const placed = plan.placed.find((item) => item.key === key)!;

          return {
            ...target,
            scheduledAt: placed.scheduledAt.toISOString(),
            slotAt: placed.slotAt?.toISOString() ?? null,
            afterEpisodeFull: placed.afterEpisodeFull,
          };
        },
      );

      // Every target is checked before anything is written
      const rows = await prepareScheduledRows(client, userId, {
        episodeId: input.episodeId,
        targets,
        aiGenerated: input.aiGenerated,
        now,
        via: 'cadence',
      });

      // Read before the write, which would put the release in it twice
      const preview = await breakingPreviewOf(client, context, now);

      const { data, error } = await client.rpc('reschedule_publishes', {
        p_moves: plan.moves.map((m) => ({
          id: m.publishId,
          slot_at: m.slotAt.toISOString(),
          scheduled_at: m.scheduledAt.toISOString(),
        })),
        p_inserts: rows.map((row) => ({
          ...row,
          release_priority: 'breaking',
        })) as unknown as Json,
      });

      if (error && CALENDAR_CHANGED.has(error.code) && attempt < 2) continue;

      if (error && CALENDAR_CHANGED.has(error.code)) {
        throw new ActionRefusal(
          'The channels’ calendar changed while this release was planned. Try again.',
        );
      }

      if (error || !data) {
        throw new Error(
          `Could not schedule the breaking release: ${error?.message ?? 'no rows'}`,
        );
      }

      return {
        ok: true,
        data: {
          scheduled: data.map((row) => ({
            publishId: row.id,
            connectionId: row.platform_connection_id ?? '',
            platform: row.platform,
            contentType: row.content_type === 'short' ? 'short' : 'full',
            shortsGroupId:
              (row.metadata as { shortsGroupId?: string | null } | null)
                ?.shortsGroupId ?? null,
            language: row.language ?? '',
            scheduledAt: row.scheduled_at ?? '',
          })),
          moves: preview.moves,
          shortsQueue: preview.shortsQueue,
          quota: preview.quota,
        },
      };
    }
  } catch (error) {
    return refused(error);
  }
}

/**
 * Shorts an earlier release held (FILM-719, before FILM-2209), appended to
 * their channels' Shorts queues like a new release's
 */
export async function requeueHeldShorts(
  client: Client,
  input: { publishIds: string[]; timezone: string },
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<{ requeued: string[] }>> {
  try {
    const { data: rows, error } = await client
      .from('publishes')
      .select('id, episode_id, platform_connection_id, content_type, metadata')
      .in('id', input.publishIds)
      .eq('status', 'draft');

    if (error) {
      throw new Error(`Could not read the held Shorts: ${error.message}`);
    }

    const heldRows = rows.filter(
      (row) =>
        row.platform_connection_id &&
        (row.metadata as { heldReason?: string } | null)?.heldReason,
    );

    if (heldRows.length === 0) {
      throw new ActionRefusal('Those Shorts are no longer held.');
    }

    const episodeIds = new Set(heldRows.map((row) => row.episode_id));

    if (episodeIds.size !== 1) {
      throw new ActionRefusal('Re-queue one episode’s Shorts at a time.');
    }

    const random = options.random ?? Math.random;
    const episodeId = heldRows[0]!.episode_id;
    const requeued: string[] = [];

    for (let attempt = 1; ; attempt++) {
      const now = options.now ?? new Date();
      const { plan } = await planFor(client, {
        episodeId,
        items: heldRows.map((row) => ({
          key: row.id,
          connectionId: row.platform_connection_id!,
          contentType: contentTypeOf(row),
        })),
        notBefore: now,
        timezone: input.timezone,
        now,
        random,
      });

      try {
        for (const item of plan.placed) {
          const row = heldRows.find((r) => r.id === item.key)!;
          const {
            heldReason: _reason,
            heldBefore: _before,
            ...metadata
          } = (row.metadata as Record<string, Json>) ?? {};

          const { data: updated, error: updateError } = await client
            .from('publishes')
            .update({
              status: 'scheduled',
              slot_at: item.slotAt.toISOString(),
              scheduled_at: item.scheduledAt.toISOString(),
              after_episode_full: item.afterEpisodeFull,
              metadata,
            })
            .eq('id', item.key)
            .eq('status', 'draft')
            .select('id');

          if (updateError?.code === '23505') throw new SlotTaken();
          if (updateError) {
            throw new Error(
              `Could not re-queue a Short: ${updateError.message}`,
            );
          }
          if (updated?.length) requeued.push(item.key);
        }
      } catch (error) {
        if (error instanceof SlotTaken && attempt < 2) {
          // Those already moved are on the calendar now; plan the rest
          heldRows.splice(
            0,
            heldRows.length,
            ...heldRows.filter((row) => !requeued.includes(row.id)),
          );
          continue;
        }

        throw error;
      }

      return { ok: true, data: { requeued } };
    }
  } catch (error) {
    return refused(error);
  }
}

/** Held Shorts the owner chose not to post: their drafts are deleted */
export async function discardHeldShorts(
  client: Client,
  publishIds: string[],
): Promise<Result<{ discarded: string[] }>> {
  const { data, error } = await client
    .from('publishes')
    .delete()
    .in('id', publishIds)
    .eq('status', 'draft')
    .not('metadata->heldReason', 'is', null)
    .select('id');

  if (error) {
    throw new Error(`Could not discard the held Shorts: ${error.message}`);
  }

  if (!data?.length) {
    return {
      ok: false,
      refusal:
        'Only project owners and admins can discard held Shorts, and only while they are held.',
    };
  }

  return { ok: true, data: { discarded: data.map((row) => row.id) } };
}

const CADENCE_COLUMNS =
  'platform_connection_id, content_type, timezone, slot_times, days_of_week, min_days_between, every_n_days, start_after_hours, jitter_minutes, enabled';

/**
 * Each channel's cadence for both content types: its own, else the defaults.
 * The Publish screen's dialog and the MCP read the same answer.
 */
export async function readChannelCadences(
  client: Client,
  connectionIds: string[],
) {
  const { data, error } = await client
    .from('channel_posting_cadences')
    .select(CADENCE_COLUMNS)
    .in('platform_connection_id', connectionIds);

  if (error) {
    throw new Error(`Could not read the channels' cadence: ${error.message}`);
  }

  return connectionIds.flatMap((connectionId) =>
    (['full', 'short'] as const).map((contentType) => {
      const row = data.find(
        (r) =>
          r.platform_connection_id === connectionId &&
          r.content_type === contentType,
      );

      return {
        connectionId,
        contentType,
        own: !!row,
        enabled: row?.enabled ?? true,
        cadence: row
          ? resolveCadence({ ...row, enabled: true }, contentType, 'UTC')
          : { ...DEFAULT_CADENCE[contentType], timezone: null },
      };
    }),
  );
}

/** Sets one channel's cadence for one content type; RLS keeps it the team's */
export async function saveChannelCadence(
  client: Client,
  input: ChannelCadenceInput,
): Promise<
  Result<{
    connectionId: string;
    contentType: ChannelCadenceInput['contentType'];
  }>
> {
  const { data: channel, error: readError } = await client
    .from('platform_connections')
    .select('id, account_id')
    .eq('id', input.connectionId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not read the channel: ${readError.message}`);
  }

  if (!channel) {
    return { ok: false, refusal: 'That channel is not one of this team’s.' };
  }

  const { error } = await client.from('channel_posting_cadences').upsert(
    {
      account_id: channel.account_id,
      platform_connection_id: input.connectionId,
      content_type: input.contentType,
      timezone: input.timezone,
      slot_times: [...input.slotTimes].sort(),
      days_of_week: [...new Set(input.daysOfWeek)].sort(),
      min_days_between: input.minDaysBetween,
      every_n_days: input.everyNDays,
      start_after_hours: input.startAfterHours,
      jitter_minutes: input.jitterMinutes,
      enabled: input.enabled,
    },
    { onConflict: 'platform_connection_id,content_type' },
  );

  if (error) {
    throw new Error(`Could not save the cadence: ${error.message}`);
  }

  return {
    ok: true,
    data: { connectionId: input.connectionId, contentType: input.contentType },
  };
}
