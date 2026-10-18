import 'server-only';

import type { ChannelMetricsDaily } from '@kit/clickhouse';
import {
  type ChannelWindowRow,
  formatDateStr,
  insertChannelMetricsDaily,
  insertChannelWindows,
} from '@kit/clickhouse/server';
import { videoSyncAuthorisation } from '@kit/publishing/oauth/analytics-scopes';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import type { InstagramAccountDay } from '../providers/instagram';
import { createInstagramInsightsProvider } from '../providers/instagram';
import type {
  YouTubeChannelDay,
  YouTubeChannelStatistics,
} from '../providers/youtube';
import { createYouTubeAnalyticsProvider } from '../providers/youtube';

/**
 * Whole-channel figures, videos StoryBook did not publish included
 * (FILM-1734; migration 025's `channel_metrics_daily`).
 *
 * - Hourly, with the analytics sync: each YouTube channel's days from the
 *   Analytics API (no video filter), over the last {@link CHANNEL_DAYS}
 *   days so YouTube's restatements are absorbed, and each Instagram
 *   account's views and unique reach for yesterday.
 * - Nightly, beside the subscriber snapshot: each YouTube channel's
 *   lifetime views, subscribers and public videos from `channels.list`.
 *
 * Never throws: a channel that fails is logged and counted, and the next
 * run asks again. One channel's outage costs no other channel its figures.
 */

/** Days asked for each hour: YouTube restates about the last three. */
export const CHANNEL_DAYS = 7;

const DAY_MS = 86_400_000;

interface ConnectionRow {
  id: string;
  platform: string;
  platform_account_id: string | null;
  scopes: string[] | null;
}

export interface ChannelTotalsResult {
  channels: number;
  rowsWritten: number;
  /** Channels that failed; each is logged and asked again next run. */
  failed: number;
}

async function getEnsureValidToken(): Promise<
  (
    connectionId: string,
  ) => Promise<{ valid: boolean; accessToken?: string; error?: string }>
> {
  const { ensureValidToken } = await import('@kit/publishing/token-refresh');
  return ensureValidToken;
}

/**
 * The active channels of these platforms whose grant reaches their
 * analytics and whose platform account id is known. Paged.
 */
async function readableConnections(
  platforms: string[],
): Promise<ConnectionRow[]> {
  const client = getSupabaseServerAdminClient();

  const rows = await fetchAllRows<ConnectionRow>(
    (from, to) =>
      client
        .from('platform_connections')
        .select('id, platform, platform_account_id, scopes')
        .eq('is_active', true)
        .is('disconnected_at', null)
        .in('platform', platforms)
        .not('platform_account_id', 'is', null)
        .order('id')
        .range(from, to),
    'channel totals connections',
  );

  return rows.filter(
    (row) =>
      videoSyncAuthorisation({
        platform: row.platform,
        grantedScopes: row.scopes,
      }) !== 'not_authorised',
  );
}

/** A YouTube channel's Analytics-API days as rows: its own figures, the rest null. */
export function buildYouTubeChannelDayRows(
  connectionId: string,
  days: readonly YouTubeChannelDay[],
): ChannelMetricsDaily[] {
  return days.map((day) => ({
    connection_id: connectionId,
    platform: 'youtube',
    metric_date: day.date,
    source: 'analytics_api',
    views: day.views,
    watch_time_seconds:
      day.estimatedMinutesWatched === null
        ? null
        : Math.round(day.estimatedMinutesWatched * 60),
    likes: day.likes,
    dislikes: day.dislikes,
    comments: day.comments,
    shares: day.shares,
    subscribers_gained: day.subscribersGained,
    subscribers_lost: day.subscribersLost,
    lifetime_views: null,
    lifetime_subscribers: null,
    lifetime_videos: null,
  }));
}

/** A YouTube channel's lifetime statistics on one day, as a `data_api` row. */
export function buildYouTubeLifetimeRow(
  connectionId: string,
  date: string,
  statistics: YouTubeChannelStatistics,
): ChannelMetricsDaily {
  return {
    connection_id: connectionId,
    platform: 'youtube',
    metric_date: date,
    source: 'data_api',
    views: null,
    watch_time_seconds: null,
    likes: null,
    dislikes: null,
    comments: null,
    shares: null,
    subscribers_gained: null,
    subscribers_lost: null,
    lifetime_views: statistics.views,
    lifetime_subscribers: statistics.subscribers,
    lifetime_videos: statistics.videos,
  };
}

/**
 * An Instagram account's day: views as a `channel_metrics_daily` row, and
 * reach — a unique count, never summed across days — as a 1-day
 * `channel_windows` row, the table built for unique figures.
 */
export function buildInstagramAccountDayRows(
  connectionId: string,
  day: InstagramAccountDay,
): { metrics: ChannelMetricsDaily[]; windows: ChannelWindowRow[] } {
  return {
    metrics:
      day.views === null
        ? []
        : [
            {
              connection_id: connectionId,
              platform: 'instagram',
              metric_date: day.date,
              source: 'graph_api',
              views: day.views,
              watch_time_seconds: null,
              likes: null,
              dislikes: null,
              comments: null,
              shares: null,
              subscribers_gained: null,
              subscribers_lost: null,
              lifetime_views: null,
              lifetime_subscribers: null,
              lifetime_videos: null,
            },
          ],
    windows:
      day.reach === null
        ? []
        : [
            {
              connectionId,
              platform: 'instagram',
              asOf: day.date,
              windowDays: 1,
              accountsReached: day.reach,
              accountsReachedFollowers: null,
              accountsReachedNonFollowers: null,
              source: 'ig_account_day',
            },
          ],
  };
}

async function forEachChannel(
  name: string,
  platforms: string[],
  read: (
    connection: ConnectionRow & { platform_account_id: string },
    accessToken: string,
  ) => Promise<number>,
): Promise<ChannelTotalsResult> {
  const logger = await getLogger();
  const ctx = { name };
  const result: ChannelTotalsResult = {
    channels: 0,
    rowsWritten: 0,
    failed: 0,
  };

  let connections: ConnectionRow[];

  try {
    connections = await readableConnections(platforms);
  } catch (error) {
    logger.error({ ...ctx, error }, 'Could not list channels');
    return { ...result, failed: 1 };
  }

  const ensureValidToken = await getEnsureValidToken();

  for (const connection of connections) {
    result.channels += 1;

    try {
      const token = await ensureValidToken(connection.id);

      if (!token.valid || !token.accessToken) {
        result.failed += 1;
        logger.warn(
          { ...ctx, connectionId: connection.id, error: token.error },
          'Skipping channel with no valid token',
        );
        continue;
      }

      result.rowsWritten += await read(
        connection as ConnectionRow & { platform_account_id: string },
        token.accessToken,
      );
    } catch (error) {
      result.failed += 1;
      logger.error(
        {
          ...ctx,
          connectionId: connection.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Channel totals failed for channel',
      );
    }
  }

  logger.info({ ...ctx, ...result }, 'Channel totals complete');

  return result;
}

/** Hourly: YouTube channel days and Instagram account days. */
export async function syncChannelDays(
  now = new Date(),
): Promise<ChannelTotalsResult> {
  const today = formatDateStr(now);
  const yesterday = formatDateStr(new Date(now.getTime() - DAY_MS));
  const start = new Date(now.getTime() - CHANNEL_DAYS * DAY_MS);

  return forEachChannel(
    'channel-totals.days',
    ['youtube', 'instagram'],
    async (connection, accessToken) => {
      if (connection.platform === 'youtube') {
        const days = await createYouTubeAnalyticsProvider(
          accessToken,
        ).getChannelDailyMetrics(
          connection.platform_account_id,
          start,
          new Date(`${today}T00:00:00Z`),
        );
        const rows = buildYouTubeChannelDayRows(connection.id, days);

        await insertChannelMetricsDaily(rows);
        return rows.length;
      }

      const day = await createInstagramInsightsProvider(
        accessToken,
        connection.platform_account_id,
      ).getAccountDay(yesterday);
      const { metrics, windows } = buildInstagramAccountDayRows(
        connection.id,
        day,
      );

      await insertChannelMetricsDaily(metrics);
      await insertChannelWindows(windows);
      return metrics.length + windows.length;
    },
  );
}

/** Nightly: each YouTube channel's lifetime statistics. */
export async function captureChannelLifetimeTotals(
  now = new Date(),
): Promise<ChannelTotalsResult> {
  const date = formatDateStr(now);

  return forEachChannel(
    'channel-totals.lifetime',
    ['youtube'],
    async (connection, accessToken) => {
      const statistics = await createYouTubeAnalyticsProvider(
        accessToken,
      ).getChannelStatistics(connection.platform_account_id);

      if (!statistics) {
        throw new Error('YouTube returned no channel for this id');
      }

      await insertChannelMetricsDaily([
        buildYouTubeLifetimeRow(connection.id, date, statistics),
      ]);
      return 1;
    },
  );
}
