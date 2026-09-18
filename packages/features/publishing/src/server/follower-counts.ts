import 'server-only';

import {
  type LatestSubscriberLevel,
  queryLatestSubscriberLevels,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';

import type { FollowerCountSource } from '../lib/types';

export interface ResolvedFollowerCount {
  followerCount: number | null;
  followerCountSource: FollowerCountSource | null;
  /** The date the figure describes: its newest data, or the connection's. */
  followerCountAsOf: string | null;
}

interface ConnectionForFollowers {
  id: string;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The follower badge's figure, per connection (FILM-1617).
 *
 * The latest dated subscriber level where one exists, falling back to
 * `metadata.followers_count`, which only the Meta callback writes. The
 * fallback is dated by the connection's `created_at`: a reconnect refreshes
 * the count without moving that date, so it can understate freshness but
 * never overstate it — unlike `updated_at`, which a token refresh bumps.
 *
 * Callers pass connections already scoped to the caller's account; the
 * ClickHouse read takes ids and has no tenant predicate of its own.
 */
export async function resolveFollowerCounts(
  connections: ConnectionForFollowers[],
): Promise<Map<string, ResolvedFollowerCount>> {
  const levels = await readLevels(connections.map((c) => c.id));

  return new Map(
    connections.map((connection) => [
      connection.id,
      resolveOne(connection, levels.get(connection.id)),
    ]),
  );
}

function resolveOne(
  connection: ConnectionForFollowers,
  level: LatestSubscriberLevel | undefined,
): ResolvedFollowerCount {
  if (level) {
    return {
      followerCount: level.level,
      followerCountSource:
        level.source === 'snapshot' ? 'snapshot' : 'reconstructed',
      followerCountAsOf: level.date,
    };
  }

  const stored = connection.metadata?.followers_count;

  if (typeof stored === 'number') {
    return {
      followerCount: stored,
      followerCountSource: 'metadata',
      followerCountAsOf: connection.created_at?.slice(0, 10) ?? null,
    };
  }

  return {
    followerCount: null,
    followerCountSource: null,
    followerCountAsOf: null,
  };
}

/**
 * A badge is decoration on the Publish Hub, so an analytics outage degrades
 * it to the stored figure rather than failing the page that publishes.
 */
async function readLevels(
  connectionIds: string[],
): Promise<Map<string, LatestSubscriberLevel>> {
  try {
    return await queryLatestSubscriberLevels(connectionIds);
  } catch (error) {
    const logger = await getLogger();

    logger.warn(
      { name: 'publishing.followerCounts', error },
      'Subscriber levels unavailable; falling back to stored follower counts',
    );

    return new Map();
  }
}
