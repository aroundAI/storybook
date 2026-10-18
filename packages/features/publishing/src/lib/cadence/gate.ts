/**
 * FILM-719, FILM-2209. The cadence rules a due post passes before it is
 * sent, for every path that sends scheduled posts: the scheduled Lambda and
 * the in-process job. One function, so the two cannot drift.
 *
 * Environment-free apart from the client it is handed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import { dailyCap, localDate, startOfLocalDay } from './cadence';
import {
  type EpisodeFullState,
  LONG_VIDEO_NEVER_WENT_OUT,
  episodeFullState,
  gateCadence,
  longVideosFor,
  postsToday,
  shiftQueue,
} from './dispatch';

type Client = SupabaseClient<Database>;

export interface GatedPublish {
  id: string;
  episode_id: string;
  platform_connection_id: string | null;
  content_type: string | null;
  metadata: Record<string, unknown> | null;
  scheduled_at: string | null;
  slot_at: string | null;
  after_episode_full: boolean;
}

export type GateOutcome = 'go' | 'waiting' | 'deferred' | 'failed';

/**
 * The state of the long video each waiting Short waits for, by the Short's
 * id, read once for a run: the episode's long video on the Short's own
 * channel when it has one there, else any of its long videos
 */
export async function longVideoStates(
  client: Client,
  publishes: readonly GatedPublish[],
) {
  const waiting = publishes.filter((p) => p.after_episode_full);
  const episodeIds = [...new Set(waiting.map((p) => p.episode_id))];
  const states = new Map<string, EpisodeFullState>();

  if (episodeIds.length === 0) return states;

  const { data, error } = await client
    .from('publishes')
    .select('episode_id, platform_connection_id, status')
    .in('episode_id', episodeIds)
    .eq('content_type', 'full');

  // Unread is not "gone": each waiting Short waits for the next run
  if (error) {
    console.error(`[Cadence] Could not read the long videos:`, error);
    for (const publish of waiting) states.set(publish.id, 'waiting');
    return states;
  }

  for (const publish of waiting) {
    const rows = longVideosFor(
      data.filter((row) => row.episode_id === publish.episode_id),
      publish.platform_connection_id,
    );
    states.set(publish.id, episodeFullState(rows.map((row) => row.status)));
  }

  return states;
}

/**
 * Whether one due post goes now. Asked one post at a time, after the posts
 * before it were claimed, so two due on one channel count each other.
 */
export async function cadenceGate(
  client: Client,
  publish: GatedPublish,
  longVideos: ReadonlyMap<string, EpisodeFullState>,
  now: Date,
): Promise<GateOutcome> {
  if (publish.after_episode_full) {
    const state = longVideos.get(publish.id) ?? 'waiting';

    if (state === 'waiting') return 'waiting';

    if (state === 'gone') {
      await client
        .from('publishes')
        .update({
          status: 'failed',
          metadata: {
            ...(publish.metadata ?? {}),
            error: LONG_VIDEO_NEVER_WENT_OUT,
            failedAt: now.toISOString(),
          } as Json,
        })
        .eq('id', publish.id)
        .eq('status', 'scheduled');

      return 'failed';
    }
  }

  return (await deferredForCap(client, publish, now)) ? 'deferred' : 'go';
}

const ON_CALENDAR = ['scheduled', 'queued', 'publishing', 'published'];

interface ChannelPost {
  id: string;
  content_type: string | null;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
}

/**
 * A post holding a cadence slot on a channel that has already had its
 * local day's posts of that type moves on, with the posts queued after it,
 * to the next free slots (shiftQueue). True when it is not sent now.
 */
async function deferredForCap(
  client: Client,
  publish: GatedPublish,
  now: Date,
) {
  if (!publish.slot_at || !publish.platform_connection_id) return false;

  const connectionId = publish.platform_connection_id;
  const contentType = publish.content_type === 'short' ? 'short' : 'full';
  const slotAt = new Date(publish.slot_at);

  const { data: row, error: cadenceError } = await client
    .from('channel_posting_cadences')
    .select(
      'platform_connection_id, content_type, timezone, slot_times, days_of_week, min_days_between, every_n_days, start_after_hours, jitter_minutes, enabled',
    )
    .eq('platform_connection_id', connectionId)
    .eq('content_type', contentType)
    .maybeSingle();

  if (cadenceError) {
    console.error(
      `[Cadence] Could not read ${publish.id}'s channel:`,
      cadenceError,
    );
    return false;
  }

  const cadence = gateCadence(row, contentType, slotAt);
  const today = localDate(now, cadence.timezone);
  const since = startOfLocalDay(today, cadence.timezone).toISOString();

  const recentQuery = client
    .from('publishes')
    .select('status, published_at')
    .eq('platform_connection_id', connectionId)
    .neq('id', publish.id)
    .or(`status.in.(queued,publishing),published_at.gte.${since}`);

  const { data: recent, error } = await (contentType === 'short'
    ? recentQuery.eq('content_type', 'short')
    : recentQuery.neq('content_type', 'short'));

  if (error) {
    console.error(`[Cadence] Could not read ${publish.id}'s channel:`, error);
    return false;
  }

  if (postsToday(recent, now, cadence.timezone) < dailyCap(cadence)) {
    return false;
  }

  // Today is full: this post and every post queued after it move on
  let calendar: ChannelPost[];
  try {
    calendar = await fetchAllRows<ChannelPost>(
      (from, to) =>
        client
          .from('publishes')
          .select('id, content_type, status, slot_at, scheduled_at')
          .eq('platform_connection_id', connectionId)
          .in('status', ON_CALENDAR)
          .or(`slot_at.gte.${publish.slot_at},scheduled_at.gte.${since}`)
          .order('id')
          .range(from, to),
      'channel queue',
    );
  } catch (readError) {
    console.error(`[Cadence] Could not read ${publish.id}'s queue:`, readError);
    return true;
  }

  // An earlier post of this run already moved it on: it is not due now
  const current = calendar.find((post) => post.id === publish.id);
  if (
    current?.slot_at &&
    new Date(current.slot_at).getTime() !== slotAt.getTime()
  ) {
    return true;
  }

  const sameType = (post: ChannelPost) =>
    (post.content_type === 'short') === (contentType === 'short');
  const inQueue = (post: ChannelPost) =>
    post.id === publish.id ||
    (sameType(post) &&
      post.status === 'scheduled' &&
      !!post.slot_at &&
      new Date(post.slot_at) > slotAt);

  const queue = [
    { ...publish, status: 'scheduled' },
    ...calendar.filter((post) => post.id !== publish.id && inQueue(post)),
  ]
    .map((post) => ({
      id: post.id,
      slotAt: new Date(post.slot_at!),
      scheduledAt: new Date(post.scheduled_at ?? post.slot_at!),
    }))
    .sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime());

  const timeOf = (post: ChannelPost) =>
    new Date((post.slot_at ?? post.scheduled_at)!);
  const rest = calendar.filter((post) => !inQueue(post));

  const moved = shiftQueue(cadence, {
    contentType,
    now,
    queue,
    others: rest.filter(sameType).map(timeOf),
    blocked: rest.filter((post) => !sameType(post) && post.slot_at).map(timeOf),
  });

  if (!moved) {
    console.error(
      `[Cadence] No free slot for ${publish.id}'s queue; left for the next run`,
    );
    return true;
  }

  // Last first: each post moves into a slot nothing holds any more
  for (const post of moved.reverse()) {
    if (post.slotAt.getTime() === post.from.getTime()) continue;

    const { data: updated, error: moveError } = await client
      .from('publishes')
      .update({
        slot_at: post.slotAt.toISOString(),
        scheduled_at: post.scheduledAt.toISOString(),
      })
      .eq('id', post.id)
      .eq('status', 'scheduled')
      .select('id');

    // Claimed or cancelled meanwhile: it holds its slot as it is
    if (!moveError && !updated?.length) {
      console.log(`[Cadence] ${post.id} is no longer scheduled; not moved`);
    }

    if (moveError) {
      console.error(
        `[Cadence] Could not move ${post.id}; the rest wait for the next run:`,
        moveError,
      );
      return true;
    }
  }

  console.log(
    `[Cadence] Channel had its day's posts; moved ${publish.id} and ${moved.length - 1} after it on`,
  );
  return true;
}
