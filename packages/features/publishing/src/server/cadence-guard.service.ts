import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { isValidTimeZone } from '../lib/cadence/cadence';
import {
  type CadenceCandidate,
  cadenceConflicts,
  describeConflict,
} from '../lib/cadence/cadence-guard';
import { cadenceOfRows, readCadences, readCalendar } from './channel-calendar';

/**
 * KB-204. The posting rules a post at a chosen time is held to, before it
 * is written: Publish now, a staggered schedule and MCP schedule_publish.
 * Reads the channels as the release planner does (channel-calendar), so
 * the guard and the planner count a channel's day alike.
 *
 * Returns the refusal, or null; never throws one, so a production build
 * shows its words.
 */

type Client = SupabaseClient<Database>;

export async function cadenceRefusal(
  client: Client,
  candidates: ReadonlyArray<Omit<CadenceCandidate, 'key'>>,
  options: { timezone?: string; now?: Date; hint: string },
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const now = options.now ?? new Date();
  const timezone =
    options.timezone && isValidTimeZone(options.timezone)
      ? options.timezone
      : 'UTC';
  const connectionIds = [...new Set(candidates.map((c) => c.connectionId))];

  const [cadences, posts, channels] = await Promise.all([
    readCadences(client, connectionIds),
    readCalendar(client, connectionIds, now),
    client
      .from('platform_connections')
      .select('id, platform_account_name')
      .in('id', connectionIds),
  ]);

  const conflicts = cadenceConflicts({
    candidates: candidates.map((candidate, index) => ({
      ...candidate,
      key: String(index),
    })),
    posts,
    cadenceOf: cadenceOfRows(cadences, timezone),
  });

  if (conflicts.length === 0) return null;

  const nameOf = (connectionId: string) =>
    channels.data?.find((c) => c.id === connectionId)?.platform_account_name ??
    'This channel';
  const reasons = [
    ...new Set(
      conflicts.map((c) => describeConflict(c, nameOf(c.connectionId))),
    ),
  ];

  return `${reasons.join(' ')} ${options.hint}`;
}
