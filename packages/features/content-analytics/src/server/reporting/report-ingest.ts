import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  insertChannelDaily,
  insertVideoMetrics,
  insertVideoReachDaily,
  insertVideoTrafficSources,
} from '@kit/clickhouse/server';
import type {
  ChannelDaily,
  VideoMetric,
  VideoReachDaily,
  VideoTrafficSource,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import {
  YOUTUBE_REPORT_TYPES,
  createYouTubeReportingProvider,
} from '../../providers/youtube/youtube-reporting';
import type { YouTubeReportingProvider } from '../../providers/youtube/youtube-reporting';
import {
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
  connectionsProcessed: number;
  jobsEnsured: number;
  reportsIngested: number;
  rowsMatched: number;
  rowsUnmatched: number;
  errors: Array<{ connectionId: string; error: string }>;
  durationMs: number;
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
 * aggregate into channel_daily so channel-wide numbers (YPP watch hours)
 * stay accurate.
 */
export async function runReportingIngestJob(): Promise<ReportIngestResult> {
  const logger = await getLogger();
  const ctx = { name: 'youtube-report-ingest' };
  const startTime = Date.now();

  const client = getSupabaseServerAdminClient();

  const result: ReportIngestResult = {
    success: true,
    connectionsProcessed: 0,
    jobsEnsured: 0,
    reportsIngested: 0,
    rowsMatched: 0,
    rowsUnmatched: 0,
    errors: [],
    durationMs: 0,
  };

  const { data: connections } = await client
    .from('platform_connections')
    .select('id, account_id')
    .eq('platform', 'youtube')
    .eq('is_active', true);

  const { ensureValidToken } = await import('@kit/publishing/token-refresh');

  for (const connection of (connections ?? []) as ConnectionRow[]) {
    result.connectionsProcessed++;

    try {
      const tokenResult = await ensureValidToken(connection.id);

      if (!tokenResult.valid || !tokenResult.accessToken) {
        throw new Error(tokenResult.error ?? 'Token validation failed');
      }

      const provider = createYouTubeReportingProvider(tokenResult.accessToken);

      const jobs = await ensureReportJobs(client, provider, connection.id);
      result.jobsEnsured += jobs.length;

      for (const job of jobs) {
        const ingested = await ingestJobReports(
          client,
          provider,
          connection,
          job,
        );
        result.reportsIngested += ingested.reportsIngested;
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

  result.success = result.errors.length === 0;
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
 * Downloads and ingests reports for one job past its watermark.
 */
async function ingestJobReports(
  client: Client,
  provider: YouTubeReportingProvider,
  connection: ConnectionRow,
  job: JobRow,
): Promise<{
  reportsIngested: number;
  rowsMatched: number;
  rowsUnmatched: number;
}> {
  const reports = await provider.listReports(
    job.youtube_job_id,
    job.last_report_created_after ?? undefined,
  );

  let reportsIngested = 0;
  let rowsMatched = 0;
  let rowsUnmatched = 0;
  let watermark = job.last_report_created_after;

  for (const report of reports.slice(0, MAX_REPORTS_PER_JOB_PER_RUN)) {
    const csv = await provider.downloadReport(report.downloadUrl);

    const ingested = await ingestReportCsv(
      client,
      connection,
      job.report_type_id,
      csv,
    );

    rowsMatched += ingested.matched;
    rowsUnmatched += ingested.unmatched;
    reportsIngested++;
    watermark = report.createTime;
  }

  if (watermark !== job.last_report_created_after) {
    await client
      .from('youtube_report_jobs')
      .update({
        last_report_created_after: watermark,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  }

  return { reportsIngested, rowsMatched, rowsUnmatched };
}

/**
 * Parses one report CSV and lands its rows in the right ClickHouse tables.
 */
async function ingestReportCsv(
  client: Client,
  connection: ConnectionRow,
  reportTypeId: string,
  csv: string,
): Promise<{ matched: number; unmatched: number }> {
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

    await insertVideoTrafficSources(trafficRows);
    return { matched: trafficRows.length, unmatched };
  }

  if (
    reportTypeId === 'channel_reach_combined_a1' ||
    reportTypeId === 'channel_reach_basic_a1'
  ) {
    const rows = parseReachReport(csv);
    const refs = await resolvePublishRefs(
      client,
      connection.id,
      rows.map((r) => r.youtubeVideoId),
    );

    const reachRows: VideoReachDaily[] = [];
    const channelRows = new Map<string, ChannelDaily>();
    let unmatched = 0;

    for (const row of rows) {
      const ref = refs.get(row.youtubeVideoId);
      if (ref) {
        reachRows.push({
          project_id: ref.projectId,
          video_id: ref.publishId,
          platform: 'youtube',
          metric_date: row.date,
          impressions: row.impressions,
          impressions_ctr: row.impressionsCtr,
          engaged_views: row.engagedViews,
        });
      } else {
        unmatched++;
        accumulateChannelDaily(channelRows, connection.id, row.date, {
          impressions: row.impressions,
          engaged_views: row.engagedViews,
        });
      }
    }

    await insertVideoReachDaily(reachRows);
    await insertChannelDaily(Array.from(channelRows.values()));
    return { matched: reachRows.length, unmatched };
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
        metric_source: 'reporting_api',
        avg_view_duration_seconds: row.avgViewDurationSeconds,
        avg_view_percentage: row.avgViewPercentage,
        dislikes: row.dislikes,
        extra_metrics: '{}',
      });
    } else {
      unmatched++;
      accumulateChannelDaily(channelRows, connection.id, row.date, {
        views: row.views,
        watch_time_seconds: row.watchTimeSeconds,
        engaged_views: row.engagedViews,
      });
    }
  }

  // Only channel_basic feeds video_metrics/channel_daily — combined is a
  // cross-check source and would double channel_daily if also aggregated.
  if (reportTypeId === 'channel_basic_a3') {
    await insertVideoMetrics(metricRows);
    await insertChannelDaily(Array.from(channelRows.values()));
    return { matched: metricRows.length, unmatched };
  }

  return { matched: 0, unmatched: 0 };
}

function accumulateChannelDaily(
  map: Map<string, ChannelDaily>,
  connectionId: string,
  date: string,
  add: Partial<Pick<
    ChannelDaily,
    'views' | 'watch_time_seconds' | 'impressions' | 'engaged_views'
  >>,
): void {
  const existing = map.get(date) ?? {
    connection_id: connectionId,
    metric_date: date,
    views: 0,
    watch_time_seconds: 0,
    impressions: 0,
    engaged_views: 0,
  };

  existing.views += add.views ?? 0;
  existing.watch_time_seconds += add.watch_time_seconds ?? 0;
  existing.impressions += add.impressions ?? 0;
  existing.engaged_views += add.engaged_views ?? 0;

  map.set(date, existing);
}

/**
 * Maps YouTube video ids to platform publishes for this connection.
 * Batched: one query per report file.
 */
async function resolvePublishRefs(
  client: Client,
  connectionId: string,
  youtubeVideoIds: string[],
): Promise<Map<string, PublishRef>> {
  const uniqueIds = Array.from(new Set(youtubeVideoIds)).filter(Boolean);
  const refs = new Map<string, PublishRef>();

  if (uniqueIds.length === 0) return refs;

  const { data } = await client
    .from('publishes')
    .select('id, platform_content_id, episodes!inner(project_id)')
    .eq('platform', 'youtube')
    .eq('platform_connection_id', connectionId)
    .in('platform_content_id', uniqueIds);

  for (const row of data ?? []) {
    const episode = row.episodes as unknown as { project_id: string | null };
    if (!row.platform_content_id || !episode?.project_id) continue;
    refs.set(row.platform_content_id, {
      publishId: row.id,
      projectId: episode.project_id,
    });
  }

  return refs;
}
