import 'server-only';

import {
  type ChannelMetricsDayRow,
  type VideoMetricDayRow,
  type VideoSnapshotRow,
  isClickHouseEnabled,
  queryAudienceRows,
  queryChannelMetricsDays,
  queryChannelReach,
  queryChannelSubscriberDays,
  queryLatestVideoSnapshots,
  queryVideoMetricDays,
  queryVideoMetricSums,
  queryVideoReachDays,
  queryVideoReachSums,
  queryVideoSnapshotDays,
} from '@kit/clickhouse/server';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';

import { ActionRefusal } from '../lib/action-result';
import {
  type AudienceShare,
  type ChannelDailyFigures,
  type DataFreshness,
  MAX_FIGURE_DAYS,
  NO_CHANNEL_FIGURES,
  NO_VIDEO_FIGURES,
  type Source,
  UNMEASURED_CLICKHOUSE_OFF,
  type VideoAudienceBreakdown,
  type VideoDailyFigures,
  type VideoFigures,
  type VideoLifetimeFigures,
  audienceMeasures,
  countChange,
  daysBetween,
  platformSource,
  previousDay,
} from '../lib/daily-figures';
import type { AnalyticsClient } from './analytics-client';
import { assertAccountAccess, assertProjectAccess } from './scope-access';
import { type SyncStatusRow, toSyncStatus } from './sync-status';

export * from '../lib/daily-figures';

/**
 * The readers a morning report is built from (FILM-1734): every figure a
 * creator would otherwise open YouTube Studio, Instagram or Facebook for,
 * per video and day, per video for its lifetime, and per channel and day.
 *
 * Every id is checked on the caller's client before ClickHouse is read,
 * which is outside Postgres RLS: a publish or channel RLS does not return,
 * or whose account the caller has no access to, refuses the whole read
 * rather than being dropped — a dropped id would read as "no figures".
 */

/** Why every figure is null, or null when the store was read. */
export function figuresUnmeasuredReason(): string | null {
  return isClickHouseEnabled() ? null : UNMEASURED_CLICKHOUSE_OFF;
}

export interface CheckedPublish {
  id: string;
  platform: string;
  projectId: string;
  connectionId: string | null;
}

interface PublishAccessRow {
  id: string;
  platform: string;
  platform_connection_id: string | null;
  episodes: { project_id: string; projects: { account_id: string } } | null;
}

/**
 * The publishes, read on the caller's client, each in an account the caller
 * has access to. RLS alone is not the check: a public project's rows are
 * readable by anyone signed in (FILM-1615 F-0), so each account is asked
 * `has_account_access` as `assertProjectAccess` does.
 */
export async function checkPublishes(
  client: AnalyticsClient,
  publishIds: string[],
): Promise<CheckedPublish[]> {
  const unique = [...new Set(publishIds)];

  if (unique.length === 0) return [];

  const rows = await fetchAllByIds<PublishAccessRow>(
    unique,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select(
          'id, platform, platform_connection_id, episodes!inner(project_id, projects!inner(account_id))',
        )
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'daily figures publishes',
  );

  if (rows.length !== unique.length) {
    throw new ActionRefusal('That video is not in your library.');
  }

  const accounts = new Set(
    rows.map((row) => row.episodes?.projects.account_id ?? ''),
  );

  for (const accountId of accounts) {
    if (!accountId) {
      throw new ActionRefusal('That video is not in your library.');
    }

    await assertAccountAccess(client, accountId).catch(() => {
      throw new ActionRefusal('That video is not in your library.');
    });
  }

  return rows
    .map((row) => ({
      id: row.id,
      platform: row.platform,
      projectId: row.episodes!.project_id,
      connectionId: row.platform_connection_id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface CheckedConnection {
  id: string;
  platform: string;
}

/** The channels, each in an account the caller has access to. */
export async function checkConnections(
  client: AnalyticsClient,
  connectionIds: string[],
): Promise<CheckedConnection[]> {
  const unique = [...new Set(connectionIds)];

  if (unique.length === 0) return [];

  const rows = await fetchAllByIds<{
    id: string;
    platform: string;
    account_id: string;
  }>(
    unique,
    (chunk, from, to) =>
      client
        .from('platform_connections')
        .select('id, platform, account_id')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'daily figures connections',
  );

  if (rows.length !== unique.length) {
    throw new ActionRefusal('That channel is not in your library.');
  }

  for (const accountId of new Set(rows.map((row) => row.account_id))) {
    await assertAccountAccess(client, accountId).catch(() => {
      throw new ActionRefusal('That channel is not in your library.');
    });
  }

  return rows
    .map((row) => ({ id: row.id, platform: row.platform }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function assertRange(from: string, to: string): string[] {
  const days = daysBetween(from, to);

  if (days.length === 0) {
    throw new ActionRefusal('The range ends before it starts.');
  }

  if (days.length > MAX_FIGURE_DAYS) {
    throw new ActionRefusal(
      `A range covers at most ${MAX_FIGURE_DAYS} days; this one covers ${days.length}.`,
    );
  }

  return days;
}

/**
 * The source of a stored `video_metrics` day: YouTube's are the Analytics
 * API's until the Reporting CSV replaced them (backfill rows were read from
 * the Analytics API too); every other platform's are its own API's deltas.
 */
function metricDaySource(row: VideoMetricDayRow): Source {
  if (row.platform !== 'youtube') return platformSource(row.platform);

  return row.metricSource === 'reporting_api'
    ? 'reporting_csv'
    : 'analytics_api';
}

const isMeta = (platform: string) =>
  platform === 'instagram' || platform === 'facebook';

/**
 * A stored day's figures. `subscribers_gained` is YouTube's subscribers
 * gained and Meta's follows, and lands in the field that says which.
 */
function metricDayFigures(row: VideoMetricDayRow): VideoFigures {
  return {
    ...NO_VIDEO_FIGURES,
    views: row.views,
    engagedViews: row.engagedViews,
    reach: row.accountsReached,
    likes: row.likes,
    dislikes: row.dislikes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    reposts: row.reposts,
    watchTimeSeconds: row.watchTimeSeconds,
    avgViewDurationSeconds: row.avgViewDurationSeconds,
    avgPercentViewed: row.avgViewPercentage,
    subscribersGained: isMeta(row.platform) ? null : row.subscribersGained,
    follows: isMeta(row.platform) ? row.subscribersGained : null,
    subscribersLost: row.subscribersLost,
    profileVisits: row.profileVisits,
    fbViews3s: row.views3s,
    fbViewsOrganic: row.views3sOrganic,
    fbViewsComplete: row.completeViews,
  };
}

/** A snapshot's lifetime figures, the same way round. */
function snapshotFigures(row: VideoSnapshotRow): VideoFigures {
  return {
    ...NO_VIDEO_FIGURES,
    views: row.views,
    reach: row.accountsReached,
    likes: row.likes,
    dislikes: row.dislikes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    reposts: row.reposts,
    watchTimeSeconds: row.watchTimeSeconds,
    subscribersGained: isMeta(row.platform) ? null : row.subscribersGained,
    follows: isMeta(row.platform) ? row.subscribersGained : null,
    profileVisits: row.profileVisits,
    reelsAvgWatchTimeMs: row.reelsAvgWatchTimeMs,
    reelsSkipRate: row.reelsSkipRate,
    fbViews3s: row.views3s,
    fbViewsOrganic: row.views3sOrganic,
    fbViewsComplete: row.completeViews,
  };
}

/** A snapshot's source; one written before migration 025 carries ''. */
function snapshotSource(row: VideoSnapshotRow): Source {
  return row.source === ''
    ? platformSource(row.platform)
    : (row.source as Source);
}

/** ClickHouse's `YYYY-MM-DD HH:MM:SS` (UTC) as ISO, and back. */
const toIso = (value: string) => `${value.replace(' ', 'T')}Z`;
const toClickHouseTime = (iso: string) => {
  const time = Date.parse(iso);

  if (Number.isNaN(time)) {
    throw new ActionRefusal(`Not a date and time: ${iso}`);
  }

  return new Date(time).toISOString().slice(0, 19).replace('T', ' ');
};

function byKey<T extends { publishId: string; source: string }>(
  a: T & { date?: string },
  b: T & { date?: string },
) {
  return (
    a.publishId.localeCompare(b.publishId) ||
    (a.date ?? '').localeCompare(b.date ?? '') ||
    a.source.localeCompare(b.source)
  );
}

/**
 * Each video's figures for each day of the range, one row per source that
 * measured it (`lib/daily-figures.ts`), sorted by publish, date and source:
 *
 * - every stored `video_metrics` day, from the source that wrote it;
 * - YouTube's `data_api` day: the change in its live counts between that
 *   day's last snapshot and the previous day's (UTC fetch days), where both
 *   exist — fresher than the Analytics API, and only views, likes,
 *   dislikes and comments;
 * - YouTube's impressions and CTR, from the Reporting CSV.
 *
 * A day nothing measured has no row. With the store off, one row per video
 * and day from the platform's own source, every figure null —
 * `figuresUnmeasuredReason()` says why.
 */
export async function getVideoDailyFigures(
  client: AnalyticsClient,
  input: { publishIds: string[]; from: string; to: string },
): Promise<VideoDailyFigures[]> {
  const days = assertRange(input.from, input.to);
  const publishes = await checkPublishes(client, input.publishIds);

  if (!isClickHouseEnabled()) {
    return publishes.flatMap((publish) =>
      days.map((date) => ({
        publishId: publish.id,
        date,
        platform: publish.platform,
        ...NO_VIDEO_FIGURES,
        source: platformSource(publish.platform),
      })),
    );
  }

  if (publishes.length === 0) return [];

  const scope = {
    projectIds: [...new Set(publishes.map((p) => p.projectId))],
    videoIds: publishes.map((p) => p.id),
  };
  const youtubeIds = publishes
    .filter((p) => p.platform === 'youtube')
    .map((p) => p.id);

  const [metricDays, snapshots, reachDays] = await Promise.all([
    queryVideoMetricDays({ ...scope, from: input.from, to: input.to }),
    queryVideoSnapshotDays({
      ...scope,
      videoIds: youtubeIds,
      from: previousDay(input.from),
      to: input.to,
    }),
    queryVideoReachDays({
      ...scope,
      videoIds: youtubeIds,
      from: input.from,
      to: input.to,
    }),
  ]);

  const rows = new Map<string, VideoDailyFigures>();
  const rowFor = (
    publishId: string,
    platform: string,
    date: string,
    source: Source,
  ) => {
    const key = `${publishId}|${date}|${source}`;
    const row = rows.get(key) ?? {
      publishId,
      date,
      platform,
      ...NO_VIDEO_FIGURES,
      source,
    };
    rows.set(key, row);
    return row;
  };

  for (const day of metricDays) {
    Object.assign(
      rowFor(day.videoId, day.platform, day.date, metricDaySource(day)),
      metricDayFigures(day),
    );
  }

  const snapshotOn = new Map(
    snapshots.map((snap) => [`${snap.videoId}|${snap.date}`, snap]),
  );

  for (const snap of snapshots) {
    const previous = snapshotOn.get(
      `${snap.videoId}|${previousDay(snap.date)}`,
    );

    if (!previous || snap.date < input.from) continue;

    Object.assign(rowFor(snap.videoId, 'youtube', snap.date, 'data_api'), {
      views: countChange(snap.views, previous.views),
      likes: countChange(snap.likes, previous.likes),
      dislikes: countChange(snap.dislikes, previous.dislikes),
      comments: countChange(snap.comments, previous.comments),
    });
  }

  for (const reach of reachDays) {
    Object.assign(
      rowFor(reach.videoId, 'youtube', reach.date, 'reporting_csv'),
      {
        impressions: reach.impressions,
        impressionCtr: reach.impressionsCtr,
      },
    );
  }

  return [...rows.values()].sort(byKey);
}

/**
 * Each video's lifetime figures as of a moment, one row per source, sorted
 * by publish and source:
 *
 * - its latest snapshot fetched by then: YouTube's live `data_api` counts,
 *   every other platform's own lifetime figures (`asOf` is the fetch);
 * - YouTube's stored days summed through that date (`analytics_api`; a day
 *   the Reporting CSV replaced is its figure), with the two averages rebuilt
 *   from their definitions (`asOf` is the last day summed, YYYY-MM-DD);
 * - YouTube's impressions summed and their CTR weighted (`reporting_csv`).
 */
export async function getVideoLifetimeFigures(
  client: AnalyticsClient,
  input: { publishIds: string[]; asOf: string },
): Promise<VideoLifetimeFigures[]> {
  const asOf = toClickHouseTime(input.asOf);
  const publishes = await checkPublishes(client, input.publishIds);

  if (!isClickHouseEnabled()) {
    return publishes.map((publish) => ({
      publishId: publish.id,
      platform: publish.platform,
      asOf: input.asOf,
      ...NO_VIDEO_FIGURES,
      source: platformSource(publish.platform),
    }));
  }

  if (publishes.length === 0) return [];

  const projectIds = [...new Set(publishes.map((p) => p.projectId))];
  const youtubeIds = publishes
    .filter((p) => p.platform === 'youtube')
    .map((p) => p.id);
  const throughDay = asOf.slice(0, 10);

  const [snapshots, totals, reach] = await Promise.all([
    queryLatestVideoSnapshots({
      projectIds,
      videoIds: publishes.map((p) => p.id),
      asOf,
    }),
    queryVideoMetricSums({
      projectIds,
      videoIds: youtubeIds,
      to: throughDay,
    }),
    queryVideoReachSums({ projectIds, videoIds: youtubeIds, to: throughDay }),
  ]);

  const rows: VideoLifetimeFigures[] = [
    ...snapshots.map((snap) => ({
      publishId: snap.videoId,
      platform: snap.platform,
      asOf: toIso(snap.fetchedAt),
      ...snapshotFigures(snap),
      source: snapshotSource(snap),
    })),
    ...totals.map((total) => ({
      publishId: total.videoId,
      platform: 'youtube',
      asOf: total.lastDate,
      ...NO_VIDEO_FIGURES,
      views: total.views,
      engagedViews: total.engagedViews,
      likes: total.likes,
      dislikes: total.dislikes,
      comments: total.comments,
      shares: total.shares,
      watchTimeSeconds: total.watchTimeSeconds,
      avgViewDurationSeconds: total.avgViewDurationSeconds,
      avgPercentViewed: total.avgViewPercentage,
      subscribersGained: total.subscribersGained,
      subscribersLost: total.subscribersLost,
      source: 'analytics_api' as const,
    })),
    ...reach.map((total) => ({
      publishId: total.videoId,
      platform: 'youtube',
      asOf: total.lastDate,
      ...NO_VIDEO_FIGURES,
      impressions: total.impressions,
      impressionCtr: total.impressionsCtr,
      source: 'reporting_csv' as const,
    })),
  ];

  return rows.sort(byKey);
}

/** The source a channel's subscriber anchor came from. */
function anchorSource(platform: string): Source {
  return platform === 'youtube' ? 'data_api' : platformSource(platform);
}

/** A stored channel day's figures, in the fields for its source. */
function channelMetricsFigures(row: ChannelMetricsDayRow) {
  if (row.source === 'data_api') {
    return {
      subscribersTotal: row.lifetimeSubscribers,
      lifetimeViews: row.lifetimeViews,
      lifetimeVideos: row.lifetimeVideos,
    };
  }

  if (row.source === 'graph_api') {
    return { accountViews: row.views };
  }

  return {
    views: row.views,
    watchTimeSeconds: row.watchTimeSeconds,
    likes: row.likes,
    dislikes: row.dislikes,
    comments: row.comments,
    shares: row.shares,
    subscribersGained: row.subscribersGained,
    subscribersLost: row.subscribersLost,
  };
}

/**
 * Each channel's whole-channel figures for each day, one row per source,
 * videos StoryBook did not publish included: YouTube's channel day
 * (`analytics_api`) and its lifetime statistics and subscriber anchor
 * (`data_api`); Instagram's account views, unique reach for the day and
 * follower anchor, and Facebook's Page reach and follower anchor
 * (`graph_api`). Sorted by channel, date and source.
 */
export async function getChannelDailyFigures(
  client: AnalyticsClient,
  input: { connectionIds: string[]; from: string; to: string },
): Promise<ChannelDailyFigures[]> {
  const days = assertRange(input.from, input.to);
  const connections = await checkConnections(client, input.connectionIds);

  if (!isClickHouseEnabled()) {
    return connections.flatMap((connection) =>
      days.map((date) => ({
        connectionId: connection.id,
        platform: connection.platform,
        date,
        ...NO_CHANNEL_FIGURES,
        source: platformSource(connection.platform),
      })),
    );
  }

  if (connections.length === 0) return [];

  const range = {
    connectionIds: connections.map((c) => c.id),
    from: input.from,
    to: input.to,
  };
  const platformOf = new Map(connections.map((c) => [c.id, c.platform]));
  const reachChannels = connections.filter((c) => isMeta(c.platform));

  const [metrics, anchors, reach] = await Promise.all([
    queryChannelMetricsDays(range),
    queryChannelSubscriberDays(range),
    Promise.all(
      reachChannels.map(async (channel) =>
        (
          await queryChannelReach({
            connectionId: channel.id,
            platform: channel.platform as 'instagram' | 'facebook',
            windowDays: 1,
            from: input.from,
            to: input.to,
          })
        ).map((day) => ({ connectionId: channel.id, ...day })),
      ),
    ),
  ]);

  const rows = new Map<string, ChannelDailyFigures>();
  const rowFor = (connectionId: string, date: string, source: Source) => {
    const key = `${connectionId}|${date}|${source}`;
    const row = rows.get(key) ?? {
      connectionId,
      platform: platformOf.get(connectionId) ?? '',
      date,
      ...NO_CHANNEL_FIGURES,
      source,
    };
    rows.set(key, row);
    return row;
  };

  for (const row of metrics) {
    Object.assign(
      rowFor(row.connectionId, row.date, row.source as Source),
      channelMetricsFigures(row),
    );
  }

  for (const anchor of anchors) {
    const row = rowFor(
      anchor.connectionId,
      anchor.date,
      anchorSource(platformOf.get(anchor.connectionId) ?? ''),
    );
    // `channels.list` that night, when stored, is the same reading.
    row.subscribersTotal ??= anchor.subscribers;
  }

  for (const day of reach.flat()) {
    rowFor(day.connectionId, day.asOf, 'graph_api').reach = day.accountsReached;
  }

  return [...rows.values()].sort(
    (a, b) =>
      a.connectionId.localeCompare(b.connectionId) ||
      a.date.localeCompare(b.date) ||
      a.source.localeCompare(b.source),
  );
}

/**
 * How recent each of a project's channels' figures are, from its
 * publishes' sync records: the newest data day and successful sync of any
 * of the channel's videos, and the outcome of the channel's most recent
 * attempt — with its error, and whether a reconnect is needed (a refused
 * grant, a missing scope or a disconnected channel). Sorted by channel.
 */
export async function getDataFreshness(
  client: AnalyticsClient,
  input: { projectId: string },
): Promise<DataFreshness[]> {
  await assertProjectAccess(client, input.projectId).catch(() => {
    throw new ActionRefusal('That project is not in your library.');
  });

  const rows = await fetchAllRows<
    SyncStatusRow & { platform_connection_id: string | null }
  >(
    (from, to) =>
      client
        .from('publishes')
        .select(
          'id, platform, metadata, platform_connection_id, episodes!inner(project_id), platform_connections!publishes_platform_connection_id_fkey(scopes, metadata, disconnected_at)',
        )
        .eq('episodes.project_id', input.projectId)
        .eq('status', 'published')
        .not('platform_connection_id', 'is', null)
        .not('platform_content_id', 'is', null)
        .order('id')
        .range(from, to),
    'freshness publishes',
  );

  const byConnection = new Map<string, DataFreshness & { attemptAt: string }>();
  const latest = (a: string | null, b: string | null) =>
    a === null ? b : b === null ? a : a > b ? a : b;

  for (const row of rows) {
    if (!row.platform_connection_id) continue;

    const status = toSyncStatus(row);
    const attemptAt = latest(status.lastSyncedAt, status.lastFailedAt) ?? '';
    const current = byConnection.get(row.platform_connection_id);
    const needsReauth =
      status.requiresReauth ||
      status.schedule === 'not_authorised' ||
      status.schedule === 'disconnected';
    const newest = !current || attemptAt > current.attemptAt;

    byConnection.set(row.platform_connection_id, {
      connectionId: row.platform_connection_id,
      platform: row.platform,
      lastDataDate: latest(current?.lastDataDate ?? null, status.lastDataDate),
      lastSyncAt: latest(current?.lastSyncAt ?? null, status.lastSyncedAt),
      status: newest
        ? (status.lastSyncStatus ?? 'never_synced')
        : current.status,
      error: newest ? status.lastError : current.error,
      needsReauth: (current?.needsReauth ?? false) || needsReauth,
      attemptAt: newest ? attemptAt : current.attemptAt,
    });
  }

  return [...byConnection.values()]
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId))
    .map(({ attemptAt: _attemptAt, ...freshness }) => freshness);
}

const AUDIENCE_DIMENSIONS = [
  ['age', 'age_group'],
  ['gender', 'gender'],
  ['country', 'country'],
  ['city', 'city'],
  ['device', 'device'],
  ['os', 'os'],
  ['subscribedStatus', 'follower_status'],
] as const;

/**
 * Who watched each video, every dimension the platforms report: age,
 * gender, country, city, device, operating system and subscribed status.
 * Each share says which of its two figures the platform measured
 * (`audienceMeasures`); the other is null. Sorted by publish, then views
 * or share, largest first. Empty with the store off.
 */
export async function getVideoAudienceBreakdown(
  client: AnalyticsClient,
  input: { publishIds: string[] },
): Promise<VideoAudienceBreakdown> {
  const publishes = await checkPublishes(client, input.publishIds);
  const breakdown: VideoAudienceBreakdown = {
    age: [],
    gender: [],
    country: [],
    city: [],
    device: [],
    os: [],
    subscribedStatus: [],
  };

  if (!isClickHouseEnabled() || publishes.length === 0) return breakdown;

  const platformOf = new Map(publishes.map((p) => [p.id, p.platform]));
  const scope = {
    projectIds: [...new Set(publishes.map((p) => p.projectId))],
    videoIds: publishes.map((p) => p.id),
  };

  await Promise.all(
    AUDIENCE_DIMENSIONS.map(async ([field, dimension]) => {
      const rows = await queryAudienceRows({ ...scope, dimension });

      breakdown[field] = rows
        .map((row): AudienceShare => {
          const platform = platformOf.get(row.videoId) ?? '';
          const measures = audienceMeasures(platform, dimension);

          return {
            publishId: row.videoId,
            platform,
            key: row.key,
            views: measures.views ? row.views : null,
            percentage: measures.percentage ? row.percentage : null,
            basis: measures.basis,
          };
        })
        .sort(
          (a, b) =>
            a.publishId.localeCompare(b.publishId) ||
            (b.views ?? b.percentage ?? 0) - (a.views ?? a.percentage ?? 0) ||
            a.key.localeCompare(b.key),
        );
    }),
  );

  return breakdown;
}
