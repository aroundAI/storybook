import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  insertChannelDaily,
  insertChannelReachDaily,
  insertVideoMetrics,
  insertVideoReachDaily,
  insertVideoTrafficSources,
  isClickHouseEnabled,
} from '@kit/clickhouse/server';
import type {
  ChannelDaily,
  ChannelReachDaily,
  VideoMetric,
  VideoReachDaily,
  VideoTrafficSource,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  YOUTUBE_REPORT_TYPES,
  createYouTubeReportingProvider,
} from '../../providers/youtube/youtube-reporting';
import type {
  YouTubeReport,
  YouTubeReportingProvider,
} from '../../providers/youtube/youtube-reporting';
import {
  findCtrOutOfRange,
  parseChannelBasicReport,
  parseReachReport,
  parseTrafficSourceReport,
} from './csv-parsers';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

const MAX_REPORTS_PER_JOB_PER_RUN = 20;

export interface ReportIngestResult {
  success: boolean;
  /**
   * False in production until the FILM-1503 cutover. Jobs are still
   * ensured then, so YouTube keeps generating, but nothing is downloaded
   * and no watermark moves: every insert would silently no-op, and a
   * watermark past a report nobody stored discards it for good.
   */
  clickhouseEnabled: boolean;
  connectionsProcessed: number;
  jobsEnsured: number;
  reportsIngested: number;
  /** Reports refused as unsafe to store (a CTR in percent). Never skipped. */
  reportsRefused: number;
  rowsMatched: number;
  rowsUnmatched: number;
  errors: Array<{ connectionId: string; error: string }>;
  durationMs: number;
}

/**
 * A reach report whose CTR cannot be a ratio. Refused, not rescaled: the
 * report stays behind the watermark and is retried until the unit is
 * settled, which is loud; a guess would be wrong silently.
 */
class ReachCtrUnitError extends Error {
  constructor(readonly maxCtr: number) {
    super(`Reach report CTR ${maxCtr} is not a ratio (expected 0..1)`);
    this.name = 'ReachCtrUnitError';
  }
}

interface ConnectionRow {
  id: string;
  account_id: string;
}

interface JobRow {
  id: string;
  report_type_id: string;
  youtube_job_id: string;
  last_report_created_after: string | null;
}

/** publish lookup value for a matched YouTube video id */
interface PublishRef {
  publishId: string;
  projectId: string;
}

/**
 * YouTube Reporting API ingest job (FILM-1504).
 *
 * Per active YouTube connection: ensures the four bulk report jobs exist,
 * downloads reports created since each job's watermark, parses the CSVs,
 * and lands the rows in ClickHouse. Rows for videos published through the
 * platform replace the Analytics-API rows for the same days (later
 * inserted_at wins under ReplacingMergeTree); unmatched channel videos
 * aggregate into the channel residual — channel_daily for the core report,
 * channel_reach_daily for reach — so channel-wide numbers (YPP watch hours)
 * stay accurate.
 *
 * With ClickHouse disabled (production until the FILM-1503 cutover) the
 * jobs are still ensured, but nothing is downloaded and no watermark moves.
 */
export async function runReportingIngestJob(): Promise<ReportIngestResult> {
  const logger = await getLogger();
  const ctx = { name: 'youtube-report-ingest' };
  const startTime = Date.now();

  const client = getSupabaseServerAdminClient();
  const clickhouseEnabled = isClickHouseEnabled();

  const result: ReportIngestResult = {
    success: true,
    clickhouseEnabled,
    connectionsProcessed: 0,
    jobsEnsured: 0,
    reportsIngested: 0,
    reportsRefused: 0,
    rowsMatched: 0,
    rowsUnmatched: 0,
    errors: [],
    durationMs: 0,
  };

  if (!clickhouseEnabled) {
    logger.info(
      ctx,
      'ClickHouse disabled — report jobs are ensured, reports are left at YouTube until it is enabled',
    );
  }

  // Paged: this is the driver loop for all report ingestion, so a channel
  // past the cap would silently never be collected from at all.
  const connections = await fetchAllRows<ConnectionRow>(
    (from, to) =>
      client
        .from('platform_connections')
        .select('id, account_id')
        .eq('platform', 'youtube')
        .eq('is_active', true)
        .order('id')
        .range(from, to),
    'active youtube connections',
  );

  const { ensureValidToken } = await import('@kit/publishing/token-refresh');

  for (const connection of connections) {
    result.connectionsProcessed++;

    try {
      const tokenResult = await ensureValidToken(connection.id);

      if (!tokenResult.valid || !tokenResult.accessToken) {
        throw new Error(tokenResult.error ?? 'Token validation failed');
      }

      const provider = createYouTubeReportingProvider(tokenResult.accessToken);

      const jobs = await ensureReportJobs(client, provider, connection.id);
      result.jobsEnsured += jobs.length;

      if (!clickhouseEnabled) continue;

      for (const job of jobs) {
        const ingested = await ingestJobReports(
          client,
          provider,
          connection,
          job,
        );
        result.reportsIngested += ingested.reportsIngested;
        result.reportsRefused += ingested.reportsRefused;
        result.rowsMatched += ingested.rowsMatched;
        result.rowsUnmatched += ingested.rowsUnmatched;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ connectionId: connection.id, error: message });
      logger.error(
        { ...ctx, connectionId: connection.id, error: message },
        'Report ingest failed for connection',
      );
    }
  }

  result.success = result.errors.length === 0 && result.reportsRefused === 0;
  result.durationMs = Date.now() - startTime;

  logger.info({ ...ctx, ...result, errors: undefined }, 'Report ingest done');

  return result;
}

/**
 * Ensures each required report type has a job on YouTube and a registry
 * row in youtube_report_jobs. Report types the API does not offer this
 * channel (e.g. reach reports rolling out) are skipped with a warning.
 */
async function ensureReportJobs(
  client: Client,
  provider: YouTubeReportingProvider,
  connectionId: string,
): Promise<JobRow[]> {
  const logger = await getLogger();

  const { data: existingRows } = await client
    .from('youtube_report_jobs')
    .select('id, report_type_id, youtube_job_id, last_report_created_after')
    .eq('platform_connection_id', connectionId)
    .eq('status', 'active');

  const existing = new Map(
    ((existingRows ?? []) as JobRow[]).map((row) => [row.report_type_id, row]),
  );

  const missing = YOUTUBE_REPORT_TYPES.filter((type) => !existing.has(type));

  if (missing.length === 0) {
    return Array.from(existing.values());
  }

  const [availableTypes, remoteJobs] = await Promise.all([
    provider.listReportTypes(),
    provider.listJobs(),
  ]);
  const remoteByType = new Map(remoteJobs.map((j) => [j.reportTypeId, j]));

  for (const reportType of missing) {
    if (!availableTypes.includes(reportType)) {
      logger.warn(
        { connectionId, reportType },
        'Report type not available for this channel — skipping',
      );
      continue;
    }

    // Reuse a job that already exists on YouTube (e.g. from a prior install)
    const job =
      remoteByType.get(reportType) ?? (await provider.createJob(reportType));

    const { data: inserted, error } = await client
      .from('youtube_report_jobs')
      .upsert(
        {
          platform_connection_id: connectionId,
          report_type_id: reportType,
          youtube_job_id: job.jobId,
          status: 'active',
        },
        { onConflict: 'platform_connection_id,report_type_id' },
      )
      .select('id, report_type_id, youtube_job_id, last_report_created_after')
      .single();

    if (error) {
      throw new Error(`Failed to register report job: ${error.message}`);
    }

    existing.set(reportType, inserted as JobRow);
  }

  return Array.from(existing.values());
}

/**
 * Which reports to process this run, and where the watermark may move after
 * each one (FILM-1504).
 *
 * `reports` must be sorted by `createTime` ascending, as the provider
 * returns them. The watermark is sent back as `createdAfter`, which lists
 * reports created *after* it — so moving it to a `createTime` that a
 * not-yet-processed report shares would skip that report for good. A run of
 * equal `createTime`s is the shape of the backfill YouTube generates when a
 * job is created, and the per-run cap can fall inside it. So a report
 * advances the watermark only when it is the last of its `createTime` in
 * the whole list; otherwise `advanceTo` is null and the watermark holds.
 *
 * A report with no `createTime` never advances it.
 */
export function planReportBatch(
  reports: YouTubeReport[],
  cap: number,
): Array<{ report: YouTubeReport; advanceTo: string | null }> {
  return reports.slice(0, cap).map((report, index) => {
    const next = reports[index + 1]?.createTime;
    const closesGroup = report.createTime !== '' && next !== report.createTime;

    return { report, advanceTo: closesGroup ? report.createTime : null };
  });
}

/**
 * Downloads and ingests reports for one job past its watermark.
 *
 * The watermark is saved as each group of reports completes, so a failure
 * part-way resumes after the last report written rather than re-downloading
 * the run. It never moves past a report whose rows were not written.
 */
async function ingestJobReports(
  client: Client,
  provider: YouTubeReportingProvider,
  connection: ConnectionRow,
  job: JobRow,
): Promise<{
  reportsIngested: number;
  reportsRefused: number;
  rowsMatched: number;
  rowsUnmatched: number;
}> {
  const logger = await getLogger();
  const ctx = {
    name: 'youtube-report-ingest',
    connectionId: connection.id,
    reportType: job.report_type_id,
  };

  const reports = await provider.listReports(
    job.youtube_job_id,
    job.last_report_created_after ?? undefined,
  );

  let reportsIngested = 0;
  let reportsRefused = 0;
  let rowsMatched = 0;
  let rowsUnmatched = 0;

  for (const { report, advanceTo } of planReportBatch(
    reports,
    MAX_REPORTS_PER_JOB_PER_RUN,
  )) {
    const csv = await provider.downloadReport(report.downloadUrl);

    let ingested: IngestedReport;

    try {
      ingested = await ingestReportCsv(
        client,
        connection,
        job.report_type_id,
        csv,
      );
    } catch (error) {
      if (!(error instanceof ReachCtrUnitError)) throw error;

      // Stop this job here: every later report would move the watermark
      // past this one. Other jobs and connections carry on.
      reportsRefused++;
      logger.error(
        { ...ctx, reportId: report.reportId, maxCtr: error.maxCtr },
        'Reach report refused: CTR is not a ratio, so storing it would be 100× off. Watermark held.',
      );
      break;
    }

    if (ingested.unparsedHeader !== null) {
      logger.warn(
        { ...ctx, reportId: report.reportId, header: ingested.unparsedHeader },
        'Report has data rows but no recognised columns — nothing stored',
      );
    }

    logger.info(
      {
        ...ctx,
        reportId: report.reportId,
        startTime: report.startTime,
        matched: ingested.matched,
        unmatched: ingested.unmatched,
        residualDates: ingested.residualDates,
      },
      'Report ingested',
    );

    rowsMatched += ingested.matched;
    rowsUnmatched += ingested.unmatched;
    reportsIngested++;

    if (advanceTo) {
      const { error } = await client
        .from('youtube_report_jobs')
        .update({
          last_report_created_after: advanceTo,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Re-processing is idempotent, so a lost write costs a re-download;
      // saying nothing would hide a registry that has stopped accepting them.
      if (error) {
        throw new Error(`Failed to save report watermark: ${error.message}`);
      }
    }
  }

  return { reportsIngested, reportsRefused, rowsMatched, rowsUnmatched };
}

interface IngestedReport {
  matched: number;
  unmatched: number;
  /** Dates given a channel-residual row, zero rows included. */
  residualDates: number;
  /** The header of a report that had data rows but parsed to none. */
  unparsedHeader: string | null;
}

/** Lines after the header that carry anything. */
function hasDataRows(csv: string): boolean {
  return csv.split(/\r?\n/).filter((line) => line.trim().length > 0).length > 1;
}

function headerOf(csv: string): string {
  return (csv.split(/\r?\n/)[0] ?? '').trim();
}

/**
 * Parses one report CSV and lands its rows in the right ClickHouse tables.
 *
 * Every date a report covers gets a channel-residual row, zero when every
 * video matched a publish. A redelivered day must replace the residual it
 * wrote before: if a video matched since, writing nothing would leave it
 * counted in both the per-video table and the residual.
 */
async function ingestReportCsv(
  client: Client,
  connection: ConnectionRow,
  reportTypeId: string,
  csv: string,
): Promise<IngestedReport> {
  const counted = (
    matched: number,
    unmatched: number,
    residualDates: number,
    parsedRows: number,
  ): IngestedReport => ({
    matched,
    unmatched,
    residualDates,
    unparsedHeader: parsedRows === 0 && hasDataRows(csv) ? headerOf(csv) : null,
  });

  if (reportTypeId === 'channel_traffic_source_a3') {
    const rows = parseTrafficSourceReport(csv);
    const refs = await resolvePublishRefs(
      client,
      connection.id,
      rows.map((r) => r.youtubeVideoId),
    );

    const trafficRows: VideoTrafficSource[] = [];
    let unmatched = 0;

    for (const row of rows) {
      const ref = refs.get(row.youtubeVideoId);
      if (!ref) {
        unmatched++;
        continue;
      }
      trafficRows.push({
        project_id: ref.projectId,
        video_id: ref.publishId,
        platform: 'youtube',
        metric_date: row.date,
        source: row.source,
        views: row.views,
        watch_time_minutes: row.watchTimeMinutes,
      });
    }

    // Unmatched traffic rows are counted, not stored: there is no residual
    // table with a source column (see queries-advanced.ts on traffic share).
    await insertVideoTrafficSources(trafficRows);
    return counted(trafficRows.length, unmatched, 0, rows.length);
  }

  if (
    reportTypeId === 'channel_reach_combined_a1' ||
    reportTypeId === 'channel_reach_basic_a1'
  ) {
    const rows = parseReachReport(csv);

    // Before anything is written: a percent file must not land at all.
    const maxCtr = findCtrOutOfRange(rows);
    if (maxCtr !== null) throw new ReachCtrUnitError(maxCtr);

    const refs = await resolvePublishRefs(
      client,
      connection.id,
      rows.map((r) => r.youtubeVideoId),
    );

    const reachRows: VideoReachDaily[] = [];
    const residual = new Map<string, ChannelReachAccumulator>();
    let unmatched = 0;

    for (const row of rows) {
      const ref = refs.get(row.youtubeVideoId);
      // Seeded for every reported date, matched or not — see above.
      accumulateChannelReach(residual, row.date, 0, 0);

      if (ref) {
        reachRows.push({
          project_id: ref.projectId,
          video_id: ref.publishId,
          platform: 'youtube',
          metric_date: row.date,
          impressions: row.impressions,
          impressions_ctr: row.impressionsCtr,
        });
      } else {
        unmatched++;
        accumulateChannelReach(
          residual,
          row.date,
          row.impressions,
          row.impressionsCtr,
        );
      }
    }

    // Its own table, never channel_daily: the reach and core reports
    // arrive separately, and on a shared key the later one's zeroes erased
    // the other's figures under FINAL (FILM-1504).
    await insertVideoReachDaily(reachRows);
    await insertChannelReachDaily(toChannelReachRows(residual, connection.id));
    return counted(reachRows.length, unmatched, residual.size, rows.length);
  }

  // channel_basic_a3 / channel_combined_a3 — per-video per-day core metrics
  const rows = parseChannelBasicReport(csv);
  const refs = await resolvePublishRefs(
    client,
    connection.id,
    rows.map((r) => r.youtubeVideoId),
  );

  const metricRows: VideoMetric[] = [];
  const channelRows = new Map<string, ChannelDaily>();
  let unmatched = 0;

  for (const row of rows) {
    const ref = refs.get(row.youtubeVideoId);
    // Seeded for every reported date, matched or not — see above.
    accumulateChannelDaily(channelRows, connection.id, row.date, {});

    if (ref) {
      metricRows.push({
        project_id: ref.projectId,
        video_id: ref.publishId,
        platform: 'youtube',
        metric_date: row.date,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: 0,
        watch_time_seconds: row.watchTimeSeconds,
        revenue_cents: 0,
        subscribers_gained: row.subscribersGained,
        subscribers_lost: row.subscribersLost,
        metric_source: 'reporting_api',
        avg_view_duration_seconds: row.avgViewDurationSeconds,
        avg_view_percentage: row.avgViewPercentage,
        dislikes: row.dislikes,
        extra_metrics: '{}',
      });
    } else {
      unmatched++;
      // Subscriber movement here belongs to a video that matched no
      // publish. It is the whole reason migration 006 added these two
      // columns to channel_daily, and until FILM-1618 it was parsed and
      // then dropped one call later — leaving the channel_daily leg of
      // querySubscriberDeltas contributing zero, always.
      accumulateChannelDaily(channelRows, connection.id, row.date, {
        views: row.views,
        watch_time_seconds: row.watchTimeSeconds,
        engaged_views: row.engagedViews,
        subscribers_gained: row.subscribersGained,
        subscribers_lost: row.subscribersLost,
      });
    }
  }

  // Only channel_basic feeds video_metrics/channel_daily — combined is a
  // cross-check source and would double channel_daily if also aggregated.
  if (reportTypeId === 'channel_basic_a3') {
    await insertVideoMetrics(metricRows);
    await insertChannelDaily(Array.from(channelRows.values()));
    return counted(metricRows.length, unmatched, channelRows.size, rows.length);
  }

  return counted(0, 0, 0, rows.length);
}

interface ChannelReachAccumulator {
  impressions: number;
  ctrWeighted: number;
}

/**
 * Accumulates one channel reach-residual entry per date, with CTR carried
 * as an impression-weighted sum so it can be averaged across videos.
 * Exported for testing, like `accumulateChannelDaily`.
 */
export function accumulateChannelReach(
  map: Map<string, ChannelReachAccumulator>,
  date: string,
  impressions: number,
  ctr: number,
): void {
  const existing = map.get(date) ?? { impressions: 0, ctrWeighted: 0 };

  existing.impressions += impressions;
  existing.ctrWeighted += ctr * impressions;

  map.set(date, existing);
}

/**
 * A day with no residual impressions stores CTR 0 beside impressions 0.
 * Every reader weights CTR by impressions, so it contributes nothing — the
 * same convention `video_reach_daily` already follows.
 */
function toChannelReachRows(
  map: Map<string, ChannelReachAccumulator>,
  connectionId: string,
): ChannelReachDaily[] {
  return Array.from(map, ([date, { impressions, ctrWeighted }]) => ({
    connection_id: connectionId,
    metric_date: date,
    impressions,
    impressions_ctr: impressions > 0 ? ctrWeighted / impressions : 0,
  }));
}

/**
 * Accumulates one channel-residual row per date.
 *
 * Exported for testing: it is the pure core of this module, and it is where
 * FILM-1618 lived. Every field of `add` is defaulted rather than assumed
 * present, so an empty `add` seeds the date with a zero row.
 *
 * Core-report (`channel_basic_a3`) figures only. The reach residual goes
 * through `accumulateChannelReach` to its own table (FILM-1504).
 */
export function accumulateChannelDaily(
  map: Map<string, ChannelDaily>,
  connectionId: string,
  date: string,
  add: Partial<Omit<ChannelDaily, 'connection_id' | 'metric_date'>>,
): void {
  const existing = map.get(date) ?? {
    connection_id: connectionId,
    metric_date: date,
    views: 0,
    watch_time_seconds: 0,
    engaged_views: 0,
    subscribers_gained: 0,
    subscribers_lost: 0,
  };

  existing.views += add.views ?? 0;
  existing.watch_time_seconds += add.watch_time_seconds ?? 0;
  existing.engaged_views += add.engaged_views ?? 0;
  existing.subscribers_gained += add.subscribers_gained ?? 0;
  existing.subscribers_lost += add.subscribers_lost ?? 0;

  map.set(date, existing);
}

/**
 * Maps YouTube video ids to platform publishes for this connection.
 *
 * Chunked and paged, and the strictest case in the codebase for it. The id
 * list comes from a whole report CSV, so its length is set by the channel's
 * library rather than by anything here: a large channel exceeds both the
 * row cap and the URI-length limit on a single `.in()`.
 *
 * Failing to resolve a video does not drop it — callers reclassify an
 * unmatched id as channel-level residual and add it to `channel_daily`.
 * `getYppProgressAction` then sums `channel_daily` with per-video metrics
 * on the stated premise that the two are disjoint complements. A truncated
 * lookup silently moves real per-video rows into the residual, double
 * counting them and inflating YPP watch hours.
 */
async function resolvePublishRefs(
  client: Client,
  connectionId: string,
  youtubeVideoIds: string[],
): Promise<Map<string, PublishRef>> {
  const uniqueIds = Array.from(new Set(youtubeVideoIds)).filter(Boolean);
  const refs = new Map<string, PublishRef>();

  if (uniqueIds.length === 0) return refs;

  const rows = await fetchAllByIds<{
    id: string;
    platform_content_id: string | null;
    episodes: unknown;
  }>(
    uniqueIds,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select('id, platform_content_id, episodes!inner(project_id)')
        .eq('platform', 'youtube')
        .eq('platform_connection_id', connectionId)
        .in('platform_content_id', chunk)
        .order('id')
        .range(from, to),
    'publishes by platform_content_id',
  );

  for (const row of rows) {
    const episode = row.episodes as unknown as { project_id: string | null };
    if (!row.platform_content_id || !episode?.project_id) continue;
    refs.set(row.platform_content_id, {
      publishId: row.id,
      projectId: episode.project_id,
    });
  }

  return refs;
}
