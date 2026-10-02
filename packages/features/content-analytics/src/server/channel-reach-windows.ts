import 'server-only';

import {
  type ChannelWindowRow,
  insertChannelWindows,
  isClickHouseEnabled,
  queryCompleteChannelWindowDays,
} from '@kit/clickhouse/server';
import { holdsRequirement } from '@kit/publishing/oauth/analytics-scopes';
import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { MetaRateLimitError, USAGE_CEILING } from '../lib/meta-usage';
import {
  FACEBOOK_PAGE_PERIODS,
  createFacebookInsightsProvider,
} from '../providers/facebook';
import { createInstagramInsightsProvider } from '../providers/instagram';

/**
 * Nightly unique reach per channel and window (cross-platform reach design,
 * approved 2026-09-28; migration 016).
 *
 * Unique reach cannot be added up from days, so each window is the
 * platform's own answer, recorded while the platform still keeps it: Meta
 * keeps about 90 days of account insights. Instagram and Facebook —
 * YouTube and TikTok offer no unique reach through the APIs we use.
 *
 * Facebook's windows are the periods Meta reports a Page's unique viewers
 * over: a day, 7 days and 28 days (`page_total_media_view_unique`,
 * FILM-1720), not Instagram's 7, 30 and 23. A Page is read only once its
 * connection holds Facebook analytics, which ships dark behind the
 * `facebook` scope switch.
 *
 * Each night fills every `as_of` in the last {@link BACKFILL_DAYS} days that
 * is missing a window, so a new channel's first night backfills its history
 * and a missed night is filled the next.
 */

/** The windows recorded for each `as_of`. */
export const REACH_WINDOWS = [
  // The two cards
  { windowDays: 7, lastDayOffset: 0 },
  { windowDays: 30, lastDayOffset: 0 },
  // The 23 days ending 7 days before `as_of`: 30-day reach minus this is
  // "new in the last 7 days (not seen in the 23 before)".
  { windowDays: 23, lastDayOffset: 7 },
] as const;

/**
 * How far back an `as_of` can be recorded: a 30-day window ending then must
 * start inside the ~90 days Meta keeps (90 − 30 = 60).
 */
export const BACKFILL_DAYS = 60;

/**
 * Stop starting new days after this long. The route runs inside a web
 * Lambda with a 30 s timeout, and a new channel's backfill is 60 days × 3
 * windows × 2 calls; the days left over are the next night's, newest first.
 */
export const TIME_BUDGET_MS = 20_000;

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The UTC-midnight bounds Meta is asked for: the window's first day, and the
 * day after its last.
 */
export function reachWindowBounds(
  asOf: string,
  window: (typeof REACH_WINDOWS)[number],
): { since: Date; until: Date } {
  const lastDay = addDays(asOf, -window.lastDayOffset);
  const firstDay = addDays(lastDay, -(window.windowDays - 1));

  return {
    since: new Date(`${firstDay}T00:00:00Z`),
    until: new Date(`${addDays(lastDay, 1)}T00:00:00Z`),
  };
}

/**
 * Every `as_of` from yesterday back {@link BACKFILL_DAYS} days that has not
 * got all its windows yet, newest first.
 */
export function missingAsOfDays(
  today: string,
  complete: ReadonlySet<string>,
): string[] {
  const days: string[] = [];

  for (let back = 1; back <= BACKFILL_DAYS; back += 1) {
    const day = addDays(today, -back);

    if (!complete.has(day)) days.push(day);
  }

  return days;
}

interface ConnectionRow {
  id: string;
  platform: string;
  platform_account_id: string | null;
  scopes: string[] | null;
}

/** The window lengths recorded per platform, for each `as_of`. */
const WINDOW_DAYS = {
  instagram: REACH_WINDOWS.map((w) => w.windowDays),
  facebook: FACEBOOK_PAGE_PERIODS.map((p) => p.windowDays),
} as const;

/** Whether this connection's channel reach is read at all. */
export function readsChannelReach(connection: {
  platform: string;
  scopes: string[] | null;
}): boolean {
  return (
    connection.platform === 'instagram' ||
    (connection.platform === 'facebook' &&
      holdsRequirement('facebook.page-insights', connection.scopes))
  );
}

export interface ChannelReachCaptureResult {
  channels: number;
  rowsWritten: number;
  /** Channels that failed; each is logged and retried the next night. */
  failed: number;
  /**
   * Channels stopped for the night by Meta's rate limit: at USAGE_CEILING of
   * the hourly allowance, or refused with a throttle code. Not failures —
   * their missing days are picked up on the next run.
   */
  throttled: number;
  /** True when the time budget ran out with days still missing. */
  budgetExhausted: boolean;
}

async function getEnsureValidToken(): Promise<
  (
    connectionId: string,
  ) => Promise<{ valid: boolean; accessToken?: string; error?: string }>
> {
  const { ensureValidToken } = await import('@kit/publishing/token-refresh');
  return ensureValidToken;
}

export async function captureChannelReachWindows(
  now: Date = new Date(),
  budgetMs: number = TIME_BUDGET_MS,
): Promise<ChannelReachCaptureResult> {
  const deadline = Date.now() + budgetMs;
  const logger = await getLogger();
  const ctx = { name: 'channel-reach-windows' };
  const today = now.toISOString().slice(0, 10);

  if (!isClickHouseEnabled()) {
    logger.info(ctx, 'ClickHouse is off; nothing to record');
    return {
      channels: 0,
      rowsWritten: 0,
      failed: 0,
      throttled: 0,
      budgetExhausted: false,
    };
  }

  const client = getSupabaseServerAdminClient();
  const ensureValidToken = await getEnsureValidToken();

  const connections = await fetchAllRows<ConnectionRow>(
    (from, to) =>
      client
        .from('platform_connections')
        .select('id, platform, platform_account_id, scopes')
        .eq('is_active', true)
        .in('platform', ['instagram', 'facebook'])
        .order('id')
        .range(from, to),
    'channel reach connections',
  );

  const read = connections.filter(readsChannelReach);

  let rowsWritten = 0;
  let failed = 0;
  let throttled = 0;
  let budgetExhausted = false;

  for (const connection of read) {
    const platform = connection.platform as 'instagram' | 'facebook';

    try {
      if (!connection.platform_account_id) {
        throw new Error(`${platform} connection has no account id`);
      }

      const token = await ensureValidToken(connection.id);

      if (!token.valid || !token.accessToken) {
        throw new Error(token.error ?? 'No valid token');
      }

      const complete = await queryCompleteChannelWindowDays({
        connectionId: connection.id,
        platform,
        windowDays: WINDOW_DAYS[platform],
        since: addDays(today, -BACKFILL_DAYS),
      });

      if (platform === 'facebook') {
        const pageId = connection.platform_account_id;
        const provider = createFacebookInsightsProvider(token.accessToken);

        for (const asOf of missingAsOfDays(today, complete)) {
          if (Date.now() >= deadline) {
            budgetExhausted = true;
            break;
          }

          const viewers = await provider.getPageUniqueViewers(pageId, asOf);
          const rows: ChannelWindowRow[] = viewers.map((window) => ({
            connectionId: connection.id,
            platform: 'facebook',
            asOf,
            windowDays: window.windowDays,
            accountsReached: window.viewers,
            // Meta splits a Page's viewers by follower for plays, not people.
            accountsReachedFollowers: null,
            accountsReachedNonFollowers: null,
            source: 'fb_page_insights',
          }));

          await insertChannelWindows(rows);
          rowsWritten += rows.length;
        }

        continue;
      }

      const provider = createInstagramInsightsProvider(
        token.accessToken,
        connection.platform_account_id,
      );

      for (const asOf of missingAsOfDays(today, complete)) {
        if (Date.now() >= deadline) {
          budgetExhausted = true;
          break;
        }

        const rows: ChannelWindowRow[] = await Promise.all(
          REACH_WINDOWS.map(async (window) => {
            const reach = await provider.getAccountReach(
              reachWindowBounds(asOf, window),
            );

            return {
              connectionId: connection.id,
              platform: 'instagram' as const,
              asOf,
              windowDays: window.windowDays,
              accountsReached: reach.accountsReached,
              accountsReachedFollowers: reach.followers,
              accountsReachedNonFollowers: reach.nonFollowers,
              source: 'ig_account_insights',
            };
          }),
        );

        // One day's windows land together, so a day is never half-recorded.
        await insertChannelWindows(rows);
        rowsWritten += rows.length;

        // Leave headroom under Meta's hourly allowance: the rest of this
        // channel's backlog waits for the next run.
        if ((provider.usagePercent ?? 0) >= USAGE_CEILING) {
          throttled += 1;
          logger.warn(
            {
              ...ctx,
              connectionId: connection.id,
              usagePercent: provider.usagePercent,
            },
            'Channel reach capture paused at the rate-limit ceiling',
          );
          break;
        }
      }
    } catch (error) {
      if (error instanceof MetaRateLimitError) {
        throttled += 1;
        logger.warn(
          { ...ctx, connectionId: connection.id, code: error.code },
          'Channel reach capture throttled by Meta; resumes next run',
        );
        continue;
      }

      // Never fatal to the batch; the missing days are retried next night.
      failed += 1;
      logger.error(
        { ...ctx, connectionId: connection.id, error },
        'Channel reach capture failed for connection',
      );
    }
  }

  logger.info(
    {
      ...ctx,
      channels: read.length,
      rowsWritten,
      failed,
      throttled,
      budgetExhausted,
    },
    'Channel reach capture complete',
  );

  return {
    channels: read.length,
    rowsWritten,
    failed,
    throttled,
    budgetExhausted,
  };
}
