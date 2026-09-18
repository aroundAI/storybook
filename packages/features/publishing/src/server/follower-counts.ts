import 'server-only';

import { isMeasuredSource } from '@kit/clickhouse';
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
  /** 0 when exact; otherwise the count may be off by up to this minus one, either way. */
  followerCountRoundingStep: number;
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
      // `constrained` and `clamped` are set only on days with an anchor, so
      // they are measured days whose figure was rounded — YouTube's every
      // snapshot above 1,000. Only `interpolated` is reconstructed.
      followerCountSource: isMeasuredSource(level.source)
        ? 'snapshot'
        : 'reconstructed',
      followerCountAsOf: level.date,
      followerCountRoundingStep: level.roundingStep,
    };
  }

  const stored = connection.metadata?.followers_count;

  if (typeof stored === 'number') {
    return {
      followerCount: stored,
      followerCountSource: 'metadata',
      followerCountAsOf: connection.created_at?.slice(0, 10) ?? null,
      followerCountRoundingStep: 0,
    };
  }

  return {
    followerCount: null,
    followerCountSource: null,
    followerCountAsOf: null,
    followerCountRoundingStep: 0,
  };
}

/**
 * How long the publish pages wait for a subscriber level before falling back
 * to the stored count. The read spans each channel's whole capture history —
 * every reader seeds from the earliest snapshot, so they agree — and joins
 * per-video metrics, so it grows with history and this cap will be reached
 * more often over time. These pages are about publishing, not analytics; a
 * stored level per connection is the remedy if the cap starts to bite.
 */
const LEVEL_READ_TIMEOUT_MS = 2_000;

/**
 * A follower count is decoration on the publish pages, so an analytics
 * outage — an error, or a read too slow to wait for — degrades it to the
 * stored figure rather than holding up the page that publishes.
 *
 * On timeout the query is abandoned, not cancelled: it still runs to
 * completion on the server. Aborting it through the ClickHouse client is a
 * separate change.
 */
async function readLevels(
  connectionIds: string[],
): Promise<Map<string, LatestSubscriberLevel>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Subscriber levels took longer than ${LEVEL_READ_TIMEOUT_MS}ms`,
          ),
        ),
      LEVEL_READ_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([
      queryLatestSubscriberLevels(connectionIds),
      timeout,
    ]);
  } catch (error) {
    const logger = await getLogger();

    logger.warn(
      { name: 'publishing.followerCounts', error },
      'Subscriber levels unavailable; falling back to stored follower counts',
    );

    return new Map();
  } finally {
    clearTimeout(timer);
  }
}
