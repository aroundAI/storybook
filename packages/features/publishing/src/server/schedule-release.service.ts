import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import { fetchAllByIds } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import {
  type ChannelCadenceRow,
  resolveCadence,
} from '../lib/cadence/cadence';
import {
  type OccupiedPost,
  type ReleaseItem,
  type ReleasePlan,
  planRelease,
} from '../lib/cadence/plan-release';
import type {
  DisplacedPost,
  HeldPost,
  ReleasePreview,
} from '../lib/cadence/release-types';
import {
  type ScheduleTarget,
  type ScheduledPublish,
  SlotTaken,
  insertScheduledRows,
  prepareScheduledRows,
} from './schedule-publishes.service';

/**
 * FILM-719. A release scheduled on its channels' cadence: the long video in
 * the channel's next free slot after its last one, its Shorts a slot at a
 * time after it, and only until the next episode's long video.
 *
 * Reads every post on the release's channels (paged: the 1000-row cap is
 * silent), plans with planRelease, holds an earlier episode's Shorts the new
 * long video displaces, and writes the release through the same
 * preparePublish the Publish screen runs. A slot another release took in the
 * meantime fails the insert on `publishes_channel_slot_key`; the release is
 * planned again once.
 */

type Client = SupabaseClient<Database>;

type Result<T> = { ok: true; data: T } | { ok: false; refusal: string };

/** One upload of the release, without a time: the cadence picks it */
export interface CadenceTarget
  extends Omit<ScheduleTarget, 'scheduledAt' | 'slotAt' | 'held'> {
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
}

const ON_CALENDAR = ['scheduled', 'queued', 'publishing'] as const;

/** How far back a published post still counts: a long video's spacing */
const PUBLISHED_LOOKBACK_DAYS = 35;

interface CalendarRow {
  id: string;
  episode_id: string;
  platform_connection_id: string | null;
  content_type: string | null;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  published_at: string | null;
}

const CALENDAR_COLUMNS =
  'id, episode_id, platform_connection_id, content_type, status, slot_at, scheduled_at, published_at';

function contentTypeOf(row: { content_type: string | null }) {
  return row.content_type === 'short' ? 'short' : 'full';
}

function postTime(row: CalendarRow) {
  const at = row.slot_at ?? row.scheduled_at ?? row.published_at;

  return at ? new Date(at) : null;
}

/** Every post on these channels a release has to plan around */
async function readCalendar(
  client: Client,
  connectionIds: string[],
  now: Date,
): Promise<OccupiedPost[]> {
  const since = new Date(
    now.getTime() - PUBLISHED_LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const [pending, published] = await Promise.all([
    fetchAllByIds<CalendarRow>(
      connectionIds,
      (chunk, from, to) =>
        client
          .from('publishes')
          .select(CALENDAR_COLUMNS)
          .in('platform_connection_id', chunk)
          .in('status', [...ON_CALENDAR])
          .order('id')
          .range(from, to),
      'channel calendar',
    ),
    fetchAllByIds<CalendarRow>(
      connectionIds,
      (chunk, from, to) =>
        client
          .from('publishes')
          .select(CALENDAR_COLUMNS)
          .in('platform_connection_id', chunk)
          .eq('status', 'published')
          .gte('published_at', since)
          .order('id')
          .range(from, to),
      'channel calendar (published)',
    ),
  ]);

  return [...pending, ...published].flatMap((row) => {
    const at = postTime(row);

    if (!at || !row.platform_connection_id) return [];

    return [
      {
        publishId: row.id,
        connectionId: row.platform_connection_id,
        episodeId: row.episode_id,
        contentType: contentTypeOf(row),
        status: row.status as OccupiedPost['status'],
        at,
      },
    ];
  });
}

/** When each episode's long video goes (or went) out: its earliest one */
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

  const anchors = new Map<string, Date>();

  for (const row of rows) {
    const at = postTime(row);
    const current = anchors.get(row.episode_id);

    if (at && (!current || at < current)) anchors.set(row.episode_id, at);
  }

  return anchors;
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

async function readCadences(client: Client, connectionIds: string[]) {
  const { data, error } = await client
    .from('channel_posting_cadences')
    .select(
      'platform_connection_id, content_type, timezone, slot_times, days_of_week, min_days_between, start_after_hours, jitter_minutes, enabled',
    )
    .in('platform_connection_id', connectionIds);

  if (error) {
    throw new Error(`Could not read the channels' cadence: ${error.message}`);
  }

  return data satisfies ChannelCadenceRow[];
}

interface PlanContext {
  plan: ReleasePlan;
  channels: Awaited<ReturnType<typeof readChannels>>;
  occupied: OccupiedPost[];
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
    mode: 'window' | 'append';
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

  const plan = planRelease({
    episodeId: input.episodeId,
    notBefore: input.notBefore,
    items: input.items,
    cadenceOf: (connectionId, contentType) =>
      resolveCadence(
        cadences.find(
          (row) =>
            row.platform_connection_id === connectionId &&
            row.content_type === contentType,
        ),
        contentType,
        input.timezone,
      ),
    occupied,
    anchors,
    now: input.now,
    random: input.random,
    mode: input.mode,
  });

  return { plan, channels, occupied };
}

async function episodeTitles(client: Client, episodeIds: string[]) {
  if (episodeIds.length === 0) return new Map<string, string>();

  const { data } = await client
    .from('episodes')
    .select('id, title')
    .in('id', [...new Set(episodeIds)]);

  return new Map((data ?? []).map((row) => [row.id, row.title]));
}

async function previewOf(
  client: Client,
  { plan, channels, occupied }: PlanContext,
): Promise<ReleasePreview> {
  const titles = await episodeTitles(
    client,
    plan.bumped.map((post) => post.episodeId),
  );

  return {
    placed: plan.placed.map((item) => ({
      key: item.key,
      connectionId: item.connectionId,
      contentType: item.contentType,
      scheduledAt: item.scheduledAt.toISOString(),
    })),
    held: plan.held.map((item) => ({
      key: item.key,
      connectionId: item.connectionId,
      reason: item.reason,
      before: item.before?.toISOString() ?? null,
    })),
    displaced: plan.bumped.map((post) => ({
      publishId: post.publishId,
      connectionId: post.connectionId,
      episodeId: post.episodeId,
      episodeTitle: titles.get(post.episodeId) ?? null,
      scheduledAt:
        occupied
          .find((o) => o.publishId === post.publishId)
          ?.at.toISOString() ?? '',
    })),
    channels: plan.channels.map((summary) => {
      const channel = channels.find((c) => c.id === summary.connectionId);

      return {
        connectionId: summary.connectionId,
        name: channel?.platform_account_name ?? 'Channel',
        platform: channel?.platform ?? '',
        queueEndsAt: summary.queueEndsAt?.toISOString() ?? null,
      };
    }),
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

/** Where the release would go, and what it would hold: nothing is written */
export async function previewCadenceRelease(
  client: Client,
  input: ReleaseInput,
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<ReleasePreview>> {
  try {
    const context = await planFor(client, {
      episodeId: input.episodeId,
      items: itemsOf(input.targets),
      notBefore: new Date(input.notBefore),
      timezone: input.timezone,
      now: options.now ?? new Date(),
      // The preview shows slots; the jitter is drawn when it is scheduled
      random: () => 0.5,
      mode: 'window',
    });

    return { ok: true, data: await previewOf(client, context) };
  } catch (error) {
    return refused(error);
  }
}

interface HoldRow {
  id: string;
  metadata: Json;
  slot_at: string | null;
  scheduled_at: string | null;
}

/**
 * An earlier episode's Shorts the new long video displaces become drafts
 * that remember why, giving their slots back. Only rows still `scheduled`
 * are touched: one the job has claimed goes out as planned.
 */
async function holdDisplaced(
  client: Client,
  bumped: ReleasePlan['bumped'],
): Promise<HoldRow[]> {
  if (bumped.length === 0) return [];

  const { data, error } = await client
    .from('publishes')
    .select('id, metadata, slot_at, scheduled_at')
    .in(
      'id',
      bumped.map((post) => post.publishId),
    )
    .eq('status', 'scheduled');

  if (error) {
    throw new Error(`Could not read the Shorts to hold: ${error.message}`);
  }

  const held: HoldRow[] = [];

  for (const row of data) {
    const post = bumped.find((b) => b.publishId === row.id)!;
    const { data: updated, error: updateError } = await client
      .from('publishes')
      .update({
        status: 'draft',
        slot_at: null,
        scheduled_at: null,
        metadata: {
          ...((row.metadata as Record<string, Json> | null) ?? {}),
          heldReason: 'next-episode',
          heldBefore: post.before.toISOString(),
        },
      })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id');

    if (updateError) {
      throw new Error(`Could not hold a Short: ${updateError.message}`);
    }

    if (updated?.length) held.push(row);
  }

  return held;
}

/** Puts held Shorts back as they were, when the release did not go in */
async function restoreHeld(client: Client, rows: HoldRow[]) {
  for (const row of rows) {
    const { data: restored } = await client
      .from('publishes')
      .update({
        status: 'scheduled',
        slot_at: row.slot_at,
        scheduled_at: row.scheduled_at,
        metadata: row.metadata,
      })
      .eq('id', row.id)
      .eq('status', 'draft')
      .select('id');

    // Left held, which the owner sees and can re-queue; never posted twice
    if (!restored?.length) {
      console.error(`[Cadence] Could not restore held Short ${row.id}`);
    }
  }
}

export interface ScheduledRelease {
  scheduled: ScheduledPublish[];
  held: HeldPost[];
  displaced: DisplacedPost[];
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
      mode: 'window',
    });
    const { plan } = context;

    if (plan.placed.length === 0) {
      throw new ActionRefusal(
        'Nothing in this release fits on its channels’ calendars. Check each channel’s posting days and slots.',
      );
    }

    const targets: ScheduleTarget[] = input.targets.map(
      ({ key, ...target }) => {
        const placed = plan.placed.find((item) => item.key === key);
        const held = plan.held.find((item) => item.key === key);

        return {
          ...target,
          scheduledAt: placed?.scheduledAt.toISOString() ?? null,
          slotAt: placed?.slotAt.toISOString() ?? null,
          afterEpisodeFull: placed?.afterEpisodeFull ?? false,
          held: held
            ? {
                reason: held.reason,
                before: held.before?.toISOString() ?? null,
              }
            : null,
        };
      },
    );

    // Every target is checked before anything is held or written
    const rows = await prepareScheduledRows(client, userId, {
      episodeId: input.episodeId,
      targets,
      aiGenerated: input.aiGenerated,
      now,
      via: 'cadence',
    });

    const preview = await previewOf(client, context);
    const heldRows = await holdDisplaced(client, plan.bumped);

    try {
      const scheduled = await insertScheduledRows(client, rows);

      return {
        scheduled,
        held: preview.held,
        displaced: preview.displaced.filter((post) =>
          heldRows.some((row) => row.id === post.publishId),
        ),
      };
    } catch (error) {
      await restoreHeld(client, heldRows);

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

/** Held Shorts of one episode, back on their channels after everything else */
export async function requeueHeldShorts(
  client: Client,
  input: { publishIds: string[]; timezone: string },
  options: { now?: Date; random?: () => number } = {},
): Promise<Result<{ requeued: string[]; stillHeld: string[] }>> {
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
        mode: 'append',
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

      return {
        ok: true,
        data: {
          requeued,
          stillHeld: plan.held.map((item) => item.key),
        },
      };
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
