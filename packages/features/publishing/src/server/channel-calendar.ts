import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllByIds } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import { type ChannelCadenceRow, resolveCadence } from '../lib/cadence/cadence';
import type { OccupiedPost } from '../lib/cadence/plan-release';

/**
 * FILM-2209, KB-204. A release's channels as the planner and the cadence
 * guard read them: every post on their calendars (paged: the 1000-row cap
 * is silent) and each channel's posting rules. One reader, so the planner
 * and the guard cannot count a channel's day differently.
 */

type Client = SupabaseClient<Database>;

export const ON_CALENDAR = ['scheduled', 'queued', 'publishing'] as const;

/** How far back a published post still counts: a long video's spacing */
const PUBLISHED_LOOKBACK_DAYS = 35;

export interface CalendarRow {
  id: string;
  episode_id: string;
  platform_connection_id: string | null;
  content_type: string | null;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  release_priority: string;
}

export const CALENDAR_COLUMNS =
  'id, episode_id, platform_connection_id, content_type, status, slot_at, scheduled_at, published_at, release_priority';

export function contentTypeOf(row: { content_type: string | null }) {
  return row.content_type === 'short' ? 'short' : 'full';
}

export function postTime(row: CalendarRow) {
  const at = row.slot_at ?? row.scheduled_at ?? row.published_at;

  return at ? new Date(at) : null;
}

/** When a post goes, or went, out: its jittered time, not its slot */
function goesAt(row: CalendarRow) {
  const at = row.published_at ?? row.scheduled_at ?? row.slot_at;

  return at ? new Date(at) : null;
}

/** Every post on these channels a release has to plan around */
export async function readCalendar(
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
        goesAt: goesAt(row) ?? at,
        slotted: !!row.slot_at,
        breaking: row.release_priority === 'breaking',
      },
    ];
  });
}

export async function readCadences(client: Client, connectionIds: string[]) {
  const { data, error } = await client
    .from('channel_posting_cadences')
    .select(
      'platform_connection_id, content_type, timezone, slot_times, days_of_week, min_days_between, every_n_days, start_after_hours, jitter_minutes, enabled',
    )
    .in('platform_connection_id', connectionIds);

  if (error) {
    throw new Error(`Could not read the channels' cadence: ${error.message}`);
  }

  return data satisfies ChannelCadenceRow[];
}

export function cadenceOfRows(cadences: ChannelCadenceRow[], timezone: string) {
  return (connectionId: string, contentType: 'full' | 'short') =>
    resolveCadence(
      cadences.find(
        (row) =>
          row.platform_connection_id === connectionId &&
          row.content_type === contentType,
      ),
      contentType,
      timezone,
    );
}
