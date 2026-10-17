/**
 * FILM-719. The cadence rules a due post passes before it is sent, for
 * every path that sends scheduled posts: the scheduled Lambda and the
 * in-process job. One function, so the two cannot drift.
 *
 * Environment-free apart from the client it is handed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import {
  type EpisodeFullState,
  LONG_VIDEO_NEVER_WENT_OUT,
  MAX_DEFER_DAYS,
  dailyCapOf,
  deferredBy,
  episodeFullState,
  postsInLastDay,
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

/** The state of each waiting Short's long video, read once for a run */
export async function longVideoStates(
  client: Client,
  publishes: readonly GatedPublish[],
) {
  const episodeIds = [
    ...new Set(
      publishes.filter((p) => p.after_episode_full).map((p) => p.episode_id),
    ),
  ];
  const states = new Map<string, EpisodeFullState>();

  if (episodeIds.length === 0) return states;

  const { data, error } = await client
    .from('publishes')
    .select('episode_id, status')
    .in('episode_id', episodeIds)
    .eq('content_type', 'full');

  // Unread is not "gone": each waiting Short waits for the next run
  if (error) {
    console.error(`[Cadence] Could not read the long videos:`, error);
    for (const id of episodeIds) states.set(id, 'waiting');
    return states;
  }

  for (const id of episodeIds) {
    states.set(
      id,
      episodeFullState(
        data.filter((row) => row.episode_id === id).map((row) => row.status),
      ),
    );
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
    const state = longVideos.get(publish.episode_id) ?? 'waiting';

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

/**
 * A post holding a cadence slot on a channel that has already had its
 * day's posts of that type is moved on to the first later day its slot is
 * free. True when it is not sent now.
 */
async function deferredForCap(
  client: Client,
  publish: GatedPublish,
  now: Date,
) {
  if (!publish.slot_at || !publish.platform_connection_id) return false;

  const short = publish.content_type === 'short';
  const since = new Date(now.getTime() - 86_400_000).toISOString();

  const recentQuery = client
    .from('publishes')
    .select('status, published_at')
    .eq('platform_connection_id', publish.platform_connection_id)
    .neq('id', publish.id)
    .or(`status.in.(queued,publishing),published_at.gt.${since}`);

  const [{ data: recent, error }, { data: cadence }] = await Promise.all([
    short
      ? recentQuery.eq('content_type', 'short')
      : recentQuery.neq('content_type', 'short'),
    client
      .from('channel_posting_cadences')
      .select('slot_times, enabled')
      .eq('platform_connection_id', publish.platform_connection_id)
      .eq('content_type', short ? 'short' : 'full')
      .maybeSingle(),
  ]);

  if (error) {
    console.error(`[Cadence] Could not read ${publish.id}'s channel:`, error);
    return false;
  }

  if (postsInLastDay(recent, now) < dailyCapOf(cadence)) return false;

  const slotAt = new Date(publish.slot_at);
  const scheduledAt = new Date(publish.scheduled_at ?? publish.slot_at);

  for (let days = 1; days <= MAX_DEFER_DAYS; days++) {
    const { data: moved, error: moveError } = await client
      .from('publishes')
      .update({
        slot_at: deferredBy(slotAt, days).toISOString(),
        scheduled_at: deferredBy(scheduledAt, days).toISOString(),
      })
      .eq('id', publish.id)
      .eq('status', 'scheduled')
      .select('id');

    // That day's slot is another post's: try the next
    if (moveError?.code === '23505') continue;

    if (moveError) {
      console.error(`[Cadence] Could not move ${publish.id}:`, moveError);
    } else if (moved.length) {
      console.log(
        `[Cadence] Channel had its day's posts; moved ${publish.id} ${days} day(s) on`,
      );
    }

    return true;
  }

  console.error(
    `[Cadence] No free slot in ${MAX_DEFER_DAYS} days for ${publish.id}; left for the next run`,
  );
  return true;
}
