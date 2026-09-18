import 'server-only';

import {
  SUBSCRIBER_TRACKED_PLATFORMS,
  type SubscriberTrackedPlatform,
} from '@kit/clickhouse';
import {
  insertSubscriberSnapshot,
  isClickHouseEnabled,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import {
  type SubscriberCountResult,
  youtubeRoundingStep,
} from '@kit/shared/subscribers';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { createInstagramInsightsProvider } from '../providers/instagram';
import { createTikTokAnalyticsProvider } from '../providers/tiktok';

/**
 * Daily absolute subscriber capture (FILM-1607).
 *
 * One anchor per connection per day. Everything else in the subscriber
 * pipeline is a delta, which gives a curve its shape but never its height.
 */

/**
 * Only these have a subscriber source (FILM-1607 §4). Shared with the
 * surfaces, which must explain an untracked platform as untracked, not as a
 * count that is missing.
 */
const SUPPORTED_PLATFORMS = SUBSCRIBER_TRACKED_PLATFORMS;

type SupportedPlatform = SubscriberTrackedPlatform;

interface ConnectionRow {
  id: string;
  platform: string;
  platform_account_id: string | null;
}

export interface SubscriberCaptureResult {
  attempted: number;
  /** Skips that recur every night by design and must never alert. */
  skippedByDesign: number;
  written: number;
  /** attempted − skippedByDesign − written. Non-zero is worth waking for. */
  shortfall: number;
}

/**
 * Dynamically imported to avoid a circular dependency, matching
 * analytics-sync-cron.ts.
 */
async function getEnsureValidToken(): Promise<
  (
    connectionId: string,
  ) => Promise<{ valid: boolean; accessToken?: string; error?: string }>
> {
  const { ensureValidToken } = await import('@kit/publishing/token-refresh');
  return ensureValidToken;
}

async function readCount(
  platform: SupportedPlatform,
  accessToken: string,
  connection: ConnectionRow,
): Promise<SubscriberCountResult> {
  switch (platform) {
    case 'youtube': {
      if (!connection.platform_account_id) {
        return { ok: false, reason: 'unavailable' };
      }

      const { YouTubeProvider } = await import(
        '@kit/publishing/providers/youtube'
      );

      // By channel id, never `mine: true` — one Google account can own
      // several channels, and `mine: true` answers for whichever YouTube
      // lists first regardless of which connection asked.
      return new YouTubeProvider(accessToken).getSubscriberCount(
        connection.platform_account_id,
      );
    }

    case 'tiktok':
      return createTikTokAnalyticsProvider(accessToken).getFollowerCount();

    case 'instagram':
      return createInstagramInsightsProvider(
        accessToken,
        connection.platform_account_id ?? '',
      ).getFollowerCount();
  }
}

/**
 * `rounding_step` for the platform and magnitude, fixed at capture where both
 * are known rather than rederived by every reader.
 */
function roundingStepFor(platform: SupportedPlatform, count: number): number {
  return platform === 'youtube' ? youtubeRoundingStep(count) : 0;
}

export async function captureSubscriberSnapshots(): Promise<SubscriberCaptureResult> {
  const logger = await getLogger();
  const ctx = { name: 'subscriber-snapshot' };

  const client = getSupabaseServerAdminClient();
  const ensureValidToken = await getEnsureValidToken();

  // The UTC date of the run. No platform returns a reporting date alongside a
  // current follower count, so there is no reporting date to prefer.
  const snapshotDate = new Date().toISOString().slice(0, 10);

  // Scoped to the platforms with a source. `platform_connections.platform`
  // also permits facebook, twitter and linkedin, all created by callback
  // routes today; attempting them would throw once per connection every
  // night forever, indistinguishable in the logs from a real outage.
  //
  // Paged: an unbounded PostgREST read caps at 1000 rows with HTTP 200 and no
  // error, so a large account would silently stop being captured.
  const connections = await fetchAllRows<ConnectionRow>(
    (from, to) =>
      client
        .from('platform_connections')
        .select('id, platform, platform_account_id')
        .eq('is_active', true)
        .in('platform', [...SUPPORTED_PLATFORMS])
        .order('id')
        .range(from, to),
    'subscriber snapshot connections',
  );

  let skippedByDesign = 0;
  let written = 0;

  for (const connection of connections) {
    const platform = connection.platform as SupportedPlatform;

    try {
      const token = await ensureValidToken(connection.id);

      if (!token.valid || !token.accessToken) {
        // A refresh that cannot be completed is a real gap, not a design
        // skip: left uncounted it would become an indefinite silent hole.
        logger.warn(
          { ...ctx, connectionId: connection.id, error: token.error },
          'Skipping connection with no valid token',
        );
        continue;
      }

      const result = await readCount(platform, token.accessToken, connection);

      if (!result.ok) {
        if (result.reason === 'hidden') {
          // A creator setting, so it recurs every night. Counted, or this
          // account sits below its own alert threshold forever.
          skippedByDesign += 1;

          logger.info(
            { ...ctx, connectionId: connection.id },
            'Subscriber count hidden by the channel owner; skipping',
          );
        } else {
          logger.warn(
            { ...ctx, connectionId: connection.id },
            'Subscriber count unavailable',
          );
        }

        continue;
      }

      await insertSubscriberSnapshot({
        connectionId: connection.id,
        snapshotDate,
        subscriberCount: result.count,
        roundingStep: roundingStepFor(platform, result.count),
      });

      written += 1;
    } catch (error) {
      // Never fatal to the batch: one platform outage must not cost every
      // other channel its anchor for the day.
      logger.error(
        { ...ctx, connectionId: connection.id, error },
        'Subscriber snapshot failed for connection',
      );
    }
  }

  const attempted = connections.length;
  const shortfall = attempted - skippedByDesign - written;

  // Gated: production runs CLICKHOUSE_ENABLED=false until the FILM-1503
  // cutover, and inserts silently return in that state — so every run
  // legitimately writes zero rows until then. An ungated alert would fire
  // nightly and train operators to ignore the one signal that matters.
  if (shortfall > 0 && isClickHouseEnabled()) {
    logger.error(
      { ...ctx, attempted, skippedByDesign, written, shortfall },
      'Subscriber snapshot shortfall — anchors missing for this day',
    );
  }

  logger.info(
    { ...ctx, snapshotDate, attempted, skippedByDesign, written, shortfall },
    'Subscriber snapshot batch complete',
  );

  return { attempted, skippedByDesign, written, shortfall };
}
