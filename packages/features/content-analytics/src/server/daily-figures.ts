import 'server-only';

import { isClickHouseEnabled } from '@kit/clickhouse/server';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';

import { ActionRefusal } from '../lib/action-result';
import {
  type ChannelDailyFigures,
  type DataFreshness,
  MAX_FIGURE_DAYS,
  NO_CHANNEL_FIGURES,
  NO_VIDEO_FIGURES,
  UNMEASURED_CLICKHOUSE_OFF,
  type VideoAudienceBreakdown,
  type VideoDailyFigures,
  type VideoLifetimeFigures,
  daysBetween,
  platformSource,
} from '../lib/daily-figures';
import type { AnalyticsClient } from './analytics-client';
import { assertAccountAccess, assertProjectAccess } from './scope-access';

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
 * Each video's figures for each day of the range, one row per source that
 * measured it (`lib/daily-figures.ts`). With the store off, one row per
 * video and day from the platform's own source, every figure null —
 * `figuresUnmeasuredReason()` says why.
 */
export async function getVideoDailyFigures(
  client: AnalyticsClient,
  input: { publishIds: string[]; from: string; to: string },
): Promise<VideoDailyFigures[]> {
  const days = assertRange(input.from, input.to);
  const publishes = await checkPublishes(client, input.publishIds);

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

/** Each video's lifetime figures as of a moment, one row per source. */
export async function getVideoLifetimeFigures(
  client: AnalyticsClient,
  input: { publishIds: string[]; asOf: string },
): Promise<VideoLifetimeFigures[]> {
  const publishes = await checkPublishes(client, input.publishIds);

  return publishes.map((publish) => ({
    publishId: publish.id,
    platform: publish.platform,
    asOf: input.asOf,
    ...NO_VIDEO_FIGURES,
    source: platformSource(publish.platform),
  }));
}

/** Each channel's whole-channel figures for each day, one row per source. */
export async function getChannelDailyFigures(
  client: AnalyticsClient,
  input: { connectionIds: string[]; from: string; to: string },
): Promise<ChannelDailyFigures[]> {
  const days = assertRange(input.from, input.to);
  const connections = await checkConnections(client, input.connectionIds);

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

/**
 * How recent each of a project's channels' figures are: the newest data day,
 * the last sync, and whether the latest attempt failed or needs a reconnect.
 */
export async function getDataFreshness(
  client: AnalyticsClient,
  input: { projectId: string },
): Promise<DataFreshness[]> {
  await assertProjectAccess(client, input.projectId).catch(() => {
    throw new ActionRefusal('That project is not in your library.');
  });

  const rows = await fetchAllRows<{
    id: string;
    platform: string;
    platform_connection_id: string | null;
  }>(
    (from, to) =>
      client
        .from('publishes')
        .select(
          'id, platform, platform_connection_id, episodes!inner(project_id)',
        )
        .eq('episodes.project_id', input.projectId)
        .eq('status', 'published')
        .not('platform_connection_id', 'is', null)
        .order('id')
        .range(from, to),
    'freshness publishes',
  );

  const byConnection = new Map<string, string>();

  for (const row of rows) {
    if (row.platform_connection_id) {
      byConnection.set(row.platform_connection_id, row.platform);
    }
  }

  return [...byConnection]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([connectionId, platform]) => ({
      connectionId,
      platform,
      lastDataDate: null,
      lastSyncAt: null,
      status: 'never_synced',
      error: null,
      needsReauth: false,
    }));
}

/** Who watched each video: every audience dimension the platforms report. */
export async function getVideoAudienceBreakdown(
  client: AnalyticsClient,
  input: { publishIds: string[] },
): Promise<VideoAudienceBreakdown> {
  await checkPublishes(client, input.publishIds);

  return {
    age: [],
    gender: [],
    country: [],
    city: [],
    device: [],
    os: [],
    subscribedStatus: [],
  };
}
