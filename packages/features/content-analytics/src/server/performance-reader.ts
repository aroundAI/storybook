import 'server-only';

import {
  isAnalyticsPlatform,
  viewDefinitionChangesBetween,
} from '@kit/clickhouse';
import { fetchAllByIds } from '@kit/shared/pagination';

import type { AnalyticsClient } from './analytics-client';
import {
  getChannelExperimentService,
  listChannelExperimentsService,
} from './channel-experiment-service';
import { listProjectChannels } from './channels';
import { getCoverageMatrixService } from './coverage-service';
import { listExperimentsService } from './experiment-service';
import { getGenomeFindingsService } from './genome-service';
import { assertScopeAccess } from './scope-access';
import { ScopedVideoLogSchema, getVideoLogService } from './video-log-service';

/**
 * Past performance for generation (FILM-1912), read through the FILM-1906
 * services on the caller's client, so the scope is proven before any
 * ClickHouse read. `createPerformanceReader(client)` is what a caller puts
 * on the generation `Ctx` as `performance`; `readProjectVideoPerformance`
 * is also the per-video read the split by generation origin uses, so the
 * two cannot disagree on what a measured video is.
 *
 * The shapes match `@kit/generation`'s `PerformanceReader` structurally;
 * this package does not depend on that one.
 */

/** Velocity: views this many days after publishing. */
export const VELOCITY_DAYS = 7;
/** The most recent publishes read; the reading says when there were more. */
export const PERFORMANCE_WINDOW = 500;

export const NOT_MEASURED_REASON =
  'Not measured: ClickHouse is off (CLICKHOUSE_ENABLED=false, production’s state), so past performance is omitted rather than shown as zero.';
export const NO_CHANNEL_REASON =
  'No channel is connected to this project, so there is no past performance to read.';

export interface MeasuredVideo {
  publishId: string;
  episodeId: string | null;
  platform: string;
  contentType: string;
  publishedAt: string;
  retentionPercent: number | null;
  viewsFirstWeek: number | null;
}

export type VideoPerformanceReading =
  | { status: 'unmeasured'; reason: string }
  | {
      status: 'measured';
      /** The age `viewsFirstWeek` is measured at. */
      velocityDays: number;
      videos: MeasuredVideo[];
      window: { mostRecent: number; truncated: boolean };
      freshness: Array<{
        platform: string;
        latestDate: string | null;
        stale: boolean;
      }>;
      viewDefinitionChanges: Array<{
        platform: string;
        date: string;
        from: string;
        to: string;
      }>;
    };

const GENOME_FAMILIES = ['short_vertical', 'long_horizontal'] as const;
const GENOME_CHANNELS = 2;
const EXPERIMENTS = 5;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Every measured video of a project's most recent `PERFORMANCE_WINDOW`
 * publishes, with its episode. Retention is the platform's lifetime
 * average percentage viewed; velocity is views at `VELOCITY_DAYS`, null
 * when that age is not reached or its window closed before ingest began.
 * With ClickHouse off, or no channel, the reading says so instead.
 */
export async function readProjectVideoPerformance(
  client: AnalyticsClient,
  projectId: string,
): Promise<VideoPerformanceReading> {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  const coverage = await getCoverageMatrixService(client, {
    scope: { projectId },
    from: isoDay(from),
    to: isoDay(to),
  });

  if (!coverage.observed) {
    return { status: 'unmeasured', reason: NOT_MEASURED_REASON };
  }

  if (coverage.channels.length === 0) {
    return { status: 'unmeasured', reason: NO_CHANNEL_REASON };
  }

  const rows = await getVideoLogService(
    client,
    ScopedVideoLogSchema.parse({
      projectId,
      checkpoints: [VELOCITY_DAYS],
      limit: PERFORMANCE_WINDOW,
      orderBy: 'published_at',
      orderDirection: 'desc',
    }),
  );

  const episodes = await fetchAllByIds<{
    id: string;
    episode_id: string | null;
  }>(
    rows.map((row) => row.videoId),
    (chunk, from, to) =>
      client
        .from('publishes')
        .select('id, episode_id')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'performance publishes',
  );
  const episodeOf = new Map(episodes.map((row) => [row.id, row.episode_id]));

  const videos = rows.map(
    (row): MeasuredVideo => ({
      publishId: row.videoId,
      episodeId: episodeOf.get(row.videoId) ?? null,
      platform: row.platform,
      contentType: row.contentType,
      publishedAt: row.publishedAt,
      retentionPercent: row.avgViewPercentage,
      viewsFirstWeek:
        row.matureAt[VELOCITY_DAYS] && !row.predatesIngestAt[VELOCITY_DAYS]
          ? (row.viewsAtAge[VELOCITY_DAYS] ?? null)
          : null,
    }),
  );

  const platforms = [...new Set(videos.map((video) => video.platform))];
  const earliest = videos.reduce<string | null>(
    (min, video) =>
      min === null || video.publishedAt < min ? video.publishedAt : min,
    null,
  );

  return {
    status: 'measured',
    velocityDays: VELOCITY_DAYS,
    videos,
    window: {
      mostRecent: PERFORMANCE_WINDOW,
      truncated: rows.length === PERFORMANCE_WINDOW,
    },
    freshness: platforms.filter(isAnalyticsPlatform).map((platform) => {
      const cell = coverage.matrix.engagement[platform];

      return {
        platform,
        latestDate: cell?.kind === 'covered' ? cell.latestDate : null,
        stale: cell?.kind === 'covered' ? cell.stale : false,
      };
    }),
    viewDefinitionChanges: earliest
      ? platforms.filter(isAnalyticsPlatform).flatMap((platform) =>
          viewDefinitionChangesBetween(
            platform,
            earliest.slice(0, 10),
            isoDay(to),
          ).map((change) => ({
            platform,
            date: change.date,
            from: change.from.label,
            to: change.to.label,
          })),
        )
      : [],
  };
}

export function createPerformanceReader(client: AnalyticsClient) {
  return {
    videos: (projectId: string) =>
      readProjectVideoPerformance(client, projectId),

    /**
     * The genome's findings for the project's active channels (at most
     * two) in the two families StoryBook makes, at one funnel stage. A
     * refusal is passed on by its kind, never scored instead.
     */
    async genome(projectId: string, funnelStage: 'hook' | 'attention') {
      const accountId = await assertScopeAccess(client, { projectId });
      const channels = (await listProjectChannels(projectId, client))
        .filter(
          (channel) =>
            channel.isActive && isAnalyticsPlatform(channel.platform),
        )
        .slice(0, GENOME_CHANNELS);

      const results = await Promise.all(
        channels.flatMap((channel) =>
          GENOME_FAMILIES.map(async (formatFamily) => ({
            channel,
            formatFamily,
            result: await getGenomeFindingsService(client, {
              accountId: accountId!,
              connectionId: channel.connectionId,
              formatFamily,
              stage: funnelStage,
              checkpointDays: 30,
              control: 'controlled',
            }),
          })),
        ),
      );

      return {
        findings: results.flatMap(({ channel, formatFamily, result }) =>
          result.status === 'analysed'
            ? result.recommendations.map((recommendation) => ({
                platform: channel.platform,
                formatFamily,
                sentence: recommendation.sentence,
              }))
            : [],
        ),
        refused: results.flatMap(({ channel, formatFamily, result }) =>
          result.status === 'refused'
            ? [`${channel.platform} ${formatFamily}: ${result.refusal.kind}`]
            : [],
        ),
      };
    },

    /**
     * Concluded Change Log entries for the project (FILM-1610) and
     * concluded channel experiments on its channels (FILM-1724), newest
     * first.
     */
    async concludedExperiments(projectId: string) {
      const accountId = (await assertScopeAccess(client, { projectId }))!;
      const channelIds = new Set(
        (await listProjectChannels(projectId, client)).map(
          (channel) => channel.connectionId,
        ),
      );

      const [changeLog, channelList] = await Promise.all([
        listExperimentsService(client, {
          accountId,
          projectId,
          status: 'concluded',
        }),
        listChannelExperimentsService(client, { accountId }),
      ]);

      const channelExperiments = await Promise.all(
        channelList
          .filter(
            (row) =>
              row.status === 'concluded' && channelIds.has(row.connection_id),
          )
          .sort((a, b) => (b.ended_at ?? '').localeCompare(a.ended_at ?? ''))
          .slice(0, EXPERIMENTS)
          .map((row) =>
            getChannelExperimentService(client, { experimentId: row.id }),
          ),
      );

      return [
        ...changeLog.map((row) => ({
          kind: 'change_log' as const,
          title: row.title,
          hypothesis: row.hypothesis,
          outcome: row.outcome_status,
          endedAt: row.ended_at,
        })),
        ...channelExperiments.map(({ experiment }) => ({
          kind: 'channel_experiment' as const,
          title: experiment.title,
          hypothesis: experiment.hypothesis,
          outcome: experiment.outcome_status,
          endedAt: experiment.ended_at,
        })),
      ]
        .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
        .slice(0, EXPERIMENTS);
    },
  };
}
