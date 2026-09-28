import 'server-only';

import type { AnalyticsPlatform } from '@kit/clickhouse';
import {
  type ChannelReachDay,
  queryChannelNewAccounts,
  queryChannelReach,
  queryPerVideoTotals,
  queryPlatformBreakdown,
  queryPostsAccountsReached,
} from '@kit/clickhouse/server';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  type Counts,
  type Measured,
  type ReachWindow,
  channelReachAvailability,
  isAnalyticsPlatform,
  isoDay,
  postReachAvailability,
  totalCounts,
  windowBounds,
} from '../lib/reach-overview';

/** How far back the history chart reaches. */
const HISTORY_DAYS = 365;

/** The posts table shows the most-viewed posts in the window. */
const POST_LIMIT = 50;

export interface ChannelReach {
  connectionId: string;
  platform: AnalyticsPlatform;
  name: string;
  reach: Measured<{
    latest: ChannelReachDay | null;
    history: ChannelReachDay[];
  }>;
  /** Instagram, 7-day window only: seen this week, not in the 23 before. */
  newAccounts: Measured<number | null> | null;
}

export interface PostRow {
  id: string;
  title: string;
  platform: AnalyticsPlatform;
  publishedAt: string | null;
  /** Null when the post has no rows in the window: unknown, not zero. */
  counts: Counts | null;
  newAccounts: Measured<number | null>;
  lifetimeReach: Measured<number | null>;
}

export interface ReachOverview {
  window: ReachWindow;
  from: string;
  to: string;
  platforms: AnalyticsPlatform[];
  counts: {
    total: Counts;
    byPlatform: Array<Counts & { platform: AnalyticsPlatform }>;
  };
  channels: ChannelReach[];
  posts: PostRow[];
}

export async function loadReachOverview(input: {
  accountId: string;
  window: ReachWindow;
  now?: Date;
}): Promise<ReachOverview> {
  const now = input.now ?? new Date();
  const { from, to } = windowBounds(input.window, now);
  const historyFrom = isoDay(
    new Date(Date.parse(`${to}T00:00:00Z`) - HISTORY_DAYS * 86_400_000),
  );

  const client = getSupabaseServerClient();

  const connections = (
    await fetchAllRows<{
      id: string;
      platform: string;
      platform_account_name: string | null;
    }>(
      (start, end) =>
        client
          .from('platform_connections')
          .select('id, platform, platform_account_name')
          .eq('account_id', input.accountId)
          .is('disconnected_at', null)
          .order('id')
          .range(start, end),
      'reach connections',
    )
  ).filter(
    (row): row is typeof row & { platform: AnalyticsPlatform } =>
      isAnalyticsPlatform(row.platform),
  );

  const projectIds = (
    await fetchAllRows<{ id: string }>(
      (start, end) =>
        client
          .from('projects')
          .select('id')
          .eq('account_id', input.accountId)
          .neq('status', 'deleted')
          .order('id')
          .range(start, end),
      'reach projects',
    )
  ).map((project) => project.id);

  const [channels, counts, posts] = await Promise.all([
    Promise.all(
      connections.map((connection) =>
        loadChannel(connection, input.window, { from: historyFrom, to }),
      ),
    ),
    loadCounts(projectIds, from, to),
    loadPosts(projectIds, from, to),
  ]);

  const platforms = [
    ...new Set([
      ...connections.map((connection) => connection.platform),
      ...counts.byPlatform.map((row) => row.platform),
    ]),
  ];

  return { window: input.window, from, to, platforms, counts, channels, posts };
}

async function loadChannel(
  connection: {
    id: string;
    platform: AnalyticsPlatform;
    platform_account_name: string | null;
  },
  window: ReachWindow,
  history: { from: string; to: string },
): Promise<ChannelReach> {
  const name = connection.platform_account_name ?? 'Unnamed channel';
  const base = {
    connectionId: connection.id,
    platform: connection.platform,
    name,
  };
  const availability = channelReachAvailability(connection.platform, window);

  // Only Instagram records channel windows today; the matrix says so, and
  // this is the read that would change if another platform did.
  if (!availability.measured || connection.platform !== 'instagram') {
    return {
      ...base,
      reach: availability.measured
        ? { measured: false, reason: 'Not measured.' }
        : availability,
      newAccounts: null,
    };
  }

  const [rows, fresh] = await Promise.all([
    queryChannelReach({
      connectionId: connection.id,
      platform: 'instagram',
      windowDays: window === 7 ? 7 : 30,
      from: history.from,
      to: history.to,
    }),
    window === 7
      ? queryChannelNewAccounts({
          connectionId: connection.id,
          from: history.to,
          to: history.to,
        })
      : Promise.resolve(null),
  ]);

  return {
    ...base,
    reach: {
      measured: true,
      value: { latest: rows.at(-1) ?? null, history: rows },
    },
    newAccounts: fresh
      ? { measured: true, value: fresh.at(-1)?.newAccounts ?? null }
      : null,
  };
}

async function loadCounts(
  projectIds: string[],
  from: string,
  to: string,
): Promise<ReachOverview['counts']> {
  if (projectIds.length === 0) {
    return { total: totalCounts([]), byPlatform: [] };
  }

  const rows = await queryPlatformBreakdown({
    projectIds,
    startDate: from,
    endDate: to,
  });

  const byPlatform = rows.map((row) => ({
    platform: row.platform,
    views: Number(row.views),
    comments: Number(row.comments),
    shares: Number(row.shares),
  }));

  return { total: totalCounts(byPlatform), byPlatform };
}

async function loadPosts(
  projectIds: string[],
  from: string,
  to: string,
): Promise<PostRow[]> {
  if (projectIds.length === 0) return [];

  const client = getSupabaseServerClient();

  const publishes = (
    await fetchAllByIds<{
      id: string;
      platform: string;
      title: string | null;
      published_at: string | null;
    }>(
      projectIds,
      (chunk, start, end) =>
        client
          .from('publishes')
          .select(
            'id, platform, title, published_at, episodes!inner (project_id)',
          )
          .in('episodes.project_id', chunk)
          .order('id')
          .range(start, end),
      'reach publishes',
    )
  ).filter(
    (row): row is typeof row & { platform: AnalyticsPlatform } =>
      isAnalyticsPlatform(row.platform),
  );

  if (publishes.length === 0) return [];

  const videoIds = publishes.map((publish) => publish.id);

  const [totals, reach] = await Promise.all([
    queryPerVideoTotals({ projectIds, videoIds, startDate: from, endDate: to }),
    queryPostsAccountsReached({ projectIds, videoIds, from, to }),
  ]);

  return publishes
    .map((publish): PostRow => {
      const total = totals.get(publish.id);
      const summary = reach.get(publish.id);
      const availability = postReachAvailability(publish.platform);

      return {
        id: publish.id,
        title: publish.title ?? 'Untitled post',
        platform: publish.platform,
        publishedAt: publish.published_at,
        counts: total
          ? {
              views: Number(total.views),
              comments: Number(total.comments),
              shares: Number(total.shares),
            }
          : null,
        newAccounts: availability.measured
          ? { measured: true, value: summary?.inRange ?? null }
          : availability,
        lifetimeReach: availability.measured
          ? { measured: true, value: summary?.lifetime ?? null }
          : availability,
      };
    })
    .sort((a, b) => (b.counts?.views ?? -1) - (a.counts?.views ?? -1))
    .slice(0, POST_LIMIT);
}
