'use server';

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  addDays,
  addMonths,
  endOfMonth,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';

import {
  queryQualityMetricsForVideos,
  queryRetentionCurve,
  queryTotalsByVideoIds,
} from '@kit/clickhouse/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { chunkIds, fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { generateSummaryCSV } from '../lib/csv-generator';
import { generatePDFReport } from '../lib/pdf-generator';
import { calculateReportSummary } from '../lib/report-summary';
import type {
  AnalyticsDataRow,
  Branding,
  DatePreset,
  GeneratedReport,
  ReportMetric,
  ReportPlatform,
  ScheduledReport,
} from '../lib/report-types';
import {
  CreateScheduledReportSchema,
  DeleteScheduledReportSchema,
  GenerateReportSchema,
  GetScheduledReportsSchema,
  UpdateScheduledReportSchema,
} from '../lib/schemas/report.schema';
import { storeReport } from './report-storage';

const SIGNED_URL_EXPIRY_SECONDS = 3600;

/** Retention curves fetched in parallel per batch. */
const RETENTION_CONCURRENCY = 20;

/**
 * Ceiling on how many videos a report fetches retention curves for.
 * Bounding concurrency caps how many run at once but not how many run in
 * total; retention is optional enrichment, so it degrades past this.
 */
const MAX_RETENTION_VIDEOS = 500;

/**
 * Calculate date range from preset
 */
function calculateDateRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();

  switch (preset) {
    case 'last7days':
      return { start: subDays(now, 7), end: now };
    case 'last30days':
      return { start: subDays(now, 30), end: now };
    case 'lastMonth': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case 'lastQuarter':
      return { start: subMonths(now, 3), end: now };
    case 'custom':
    default:
      return { start: subDays(now, 30), end: now };
  }
}

/**
 * Calculate next run time for scheduled report
 */
function calculateNextRunTime(frequency: 'weekly' | 'monthly'): Date {
  const now = new Date();

  if (frequency === 'weekly') {
    const currentDay = now.getUTCDay();
    const currentHour = now.getUTCHours();

    // If it's Monday before 8:00 UTC, schedule for today
    if (currentDay === 1 && currentHour < 8) {
      const today = new Date(now);
      today.setUTCHours(8, 0, 0, 0);
      return today;
    }

    // Otherwise, schedule for next Monday
    const daysUntilMonday = (8 - currentDay) % 7 || 7;
    const nextMonday = addDays(now, daysUntilMonday);
    nextMonday.setUTCHours(8, 0, 0, 0);
    return nextMonday;
  } else {
    const currentDay = now.getUTCDate();
    const currentHour = now.getUTCHours();

    // If it's the 1st before 8:00 UTC, schedule for today
    if (currentDay === 1 && currentHour < 8) {
      const today = new Date(now);
      today.setUTCHours(8, 0, 0, 0);
      return today;
    }

    // Otherwise, schedule for next month's 1st
    const nextMonth = addMonths(startOfMonth(now), 1);
    nextMonth.setUTCHours(8, 0, 0, 0);
    return nextMonth;
  }
}

/**
 * Fetch analytics data for report.
 * Metadata from Supabase, metrics from ClickHouse.
 */
async function fetchAnalyticsData(
  accountId: string,
  dateRange: { start: Date; end: Date },
  platforms: string[],
  projectIds?: string[],
  includeRetention = false,
): Promise<AnalyticsDataRow[]> {
  const client = getSupabaseServerClient();

  const PUBLISH_COLUMNS = `
      id,
      platform,
      title,
      episodes!inner (
        title,
        seasons!inner (
          projects!inner (
            id,
            name,
            account_id
          )
        )
      )
    `;

  interface ReportPublishRow {
    id: string;
    platform: string;
    title: string | null;
    episodes: unknown;
  }

  const basePublishQuery = () =>
    client
      .from('publishes')
      .select(PUBLISH_COLUMNS)
      .in('platform', platforms)
      .eq('episodes.seasons.projects.account_id', accountId);

  // Paged: these ids are the report's content set, so truncation silently
  // drops rows from the delivered report and from every total derived from
  // it. `projectIds` is caller-supplied with no schema cap, and a filter
  // list is serialized into the request URI — so it is chunked too, and
  // chunking matters more here because the list would otherwise be
  // re-serialized on every page. Chunk results are concatenated, so the id
  // ordering is per-chunk; the caller only uses these as a set.
  const data =
    projectIds && projectIds.length > 0
      ? await fetchAllByIds<ReportPublishRow>(
          projectIds,
          (chunk, from, to) =>
            basePublishQuery()
              .in('episodes.seasons.projects.id', chunk)
              .order('id')
              .range(from, to),
          'report publishes (by project)',
        )
      : await fetchAllRows<ReportPublishRow>(
          (from, to) => basePublishQuery().order('id').range(from, to),
          'report publishes',
        );

  if (data.length === 0) {
    return [];
  }

  const publishIds = data.map((row) => row.id);
  const startDateStr = dateRange.start.toISOString().split('T')[0]!;
  const endDateStr = dateRange.end.toISOString().split('T')[0]!;

  // Get metrics from ClickHouse
  const [perVideoTotals, qualityMetrics] = await Promise.all([
    queryTotalsByVideoIds(publishIds, {
      startDate: startDateStr,
      endDate: endDateStr,
      ...(projectIds?.length ? { projectIds } : {}),
    }),
    queryQualityMetricsForVideos({
      videoIds: publishIds,
      // Only when the report names its projects; a report over a whole
      // account has no single set to bound by.
      ...(projectIds?.length ? { projectIds } : {}),
      startDate: startDateStr,
      endDate: endDateStr,
    }),
  ]);

  // Retention curves are lifetime aggregates fetched per video, so only
  // pull them when the report actually includes the retention column
  const retentionByPublish = new Map<string, Record<string, number>>();

  if (includeRetention) {
    // Bounded fan-out: one ClickHouse round trip per video, and publishIds
    // is no longer implicitly capped now that the publish read is paged.
    // `perVideoTotals.has(id)` narrows this set without bounding it.
    const withMetrics = publishIds
      .filter((id) => perVideoTotals.has(id))
      .slice(0, MAX_RETENTION_VIDEOS);

    for (const batch of chunkIds(withMetrics, RETENTION_CONCURRENCY)) {
      await Promise.all(
        batch.map(async (publishId) => {
          const points = await queryRetentionCurve({
            videoId: publishId,
            // One query per video, up to MAX_RETENTION_VIDEOS of them, so
            // this is the read that most needs bounding — unscoped it
            // scans video_retention_curves once per video in the report.
            ...(projectIds?.length ? { projectIds } : {}),
          });

          if (points.length > 0) {
            retentionByPublish.set(
              publishId,
              Object.fromEntries(
                points.map((p) => [
                  p.elapsedRatio.toFixed(2),
                  p.audienceWatchRatio,
                ]),
              ),
            );
          }
        }),
      );
    }
  }

  // Merge metadata with metrics
  return data
    .filter((row) => perVideoTotals.has(row.id))
    .map((row) => {
      const stats = perVideoTotals.get(row.id)!;
      const quality = qualityMetrics.get(row.id);
      const episodes = row.episodes as unknown as {
        title: string;
        seasons: { projects: { name: string } };
      };

      return {
        snapshotDate: endDateStr,
        platform: row.platform,
        contentTitle: row.title || episodes.title,
        projectName: episodes.seasons.projects.name,
        views: stats.views,
        likes: stats.likes,
        comments: stats.comments,
        shares: stats.shares,
        // Null, not 0, where the platform does not measure it (KB-114).
        watchTimeSeconds: stats.measured.watch_time_seconds
          ? stats.watch_time_seconds
          : null,
        subscribersGained: stats.measured.subscribers_gained
          ? stats.subscribers_gained
          : null,
        revenueCents: stats.revenue_cents,
        retentionData: retentionByPublish.get(row.id) ?? null,
        impressions: quality?.impressions ?? 0,
        ctr: quality?.impressionsCtr ?? 0,
        avgViewDurationSeconds: quality?.avgViewDurationSeconds ?? null,
      };
    });
}

/**
 * Upload file to storage and get signed URL
 */
async function uploadAndGetSignedUrl(
  accountId: string,
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<{ url: string; expiresAt: Date }> {
  return storeReport(
    getSupabaseServerClient(),
    `exports/${accountId}/${Date.now()}-${filename}`,
    { buffer, contentType, cacheControl: '3600' },
    SIGNED_URL_EXPIRY_SECONDS,
  );
}

/**
 * Generate and return a report with signed download URL
 */
const generateReport = enhanceAction(
  async function (data): Promise<GeneratedReport> {
    const { accountId, config } = data;

    const dateRange =
      config.dateRange.preset && config.dateRange.preset !== 'custom'
        ? calculateDateRange(config.dateRange.preset)
        : { start: config.dateRange.start, end: config.dateRange.end };

    const analyticsData = await fetchAnalyticsData(
      accountId,
      dateRange,
      config.platforms,
      config.projectIds,
      config.metrics.includes('retention'),
    );

    if (analyticsData.length === 0) {
      throw new ActionRefusal(
        'No data found for the selected date range and filters',
      );
    }

    let buffer: Buffer;
    let filename: string;
    let contentType: string;

    if (config.type === 'csv') {
      const csvContent = generateSummaryCSV(
        analyticsData,
        config.metrics as ReportMetric[],
        dateRange,
      );
      buffer = Buffer.from(csvContent, 'utf-8');
      filename = `analytics-report-${dateRange.start.toISOString().split('T')[0]}.csv`;
      contentType = 'text/csv';
    } else {
      const summary = calculateReportSummary(analyticsData);
      buffer = await generatePDFReport({
        data: analyticsData,
        summary,
        dateRange,
        metrics: config.metrics as ReportMetric[],
        branding: config.branding,
      });
      filename = `analytics-report-${dateRange.start.toISOString().split('T')[0]}.pdf`;
      contentType = 'application/pdf';
    }

    const { url, expiresAt } = await uploadAndGetSignedUrl(
      accountId,
      buffer,
      filename,
      contentType,
    );

    return {
      downloadUrl: url,
      expiresAt,
      type: config.type,
      dateRange,
      recordCount: analyticsData.length,
    };
  },
  {
    auth: true,
    schema: GenerateReportSchema,
  },
);

export const generateReportAction = returnRefusals(generateReport);

/**
 * Create a new scheduled report
 */
export const createScheduledReportAction = enhanceAction(
  async function (data): Promise<ScheduledReport> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseServerClient() as SupabaseClient<any>;

    const nextRunAt = calculateNextRunTime(data.frequency);

    const { data: created, error } = await client
      .from('scheduled_reports')
      .insert({
        account_id: data.accountId,
        name: data.name,
        report_type: data.reportType,
        frequency: data.frequency,
        metrics: data.metrics,
        platforms: data.platforms,
        project_ids: data.projectIds || null,
        branding: data.branding || null,
        recipients: data.recipients,
        next_run_at: nextRunAt.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create scheduled report: ${error.message}`);
    }

    return mapDbToScheduledReport(created);
  },
  {
    auth: true,
    schema: CreateScheduledReportSchema,
  },
);

/**
 * Update an existing scheduled report
 */
export const updateScheduledReportAction = enhanceAction(
  async function (data): Promise<ScheduledReport> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseServerClient() as SupabaseClient<any>;

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.reportType !== undefined) updateData.report_type = data.reportType;
    if (data.metrics !== undefined) updateData.metrics = data.metrics;
    if (data.platforms !== undefined) updateData.platforms = data.platforms;
    if (data.projectIds !== undefined) updateData.project_ids = data.projectIds;
    if (data.branding !== undefined) updateData.branding = data.branding;
    if (data.recipients !== undefined) updateData.recipients = data.recipients;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    if (data.frequency !== undefined) {
      updateData.frequency = data.frequency;
      updateData.next_run_at = calculateNextRunTime(
        data.frequency,
      ).toISOString();
    }

    const { data: updated, error } = await client
      .from('scheduled_reports')
      .update(updateData)
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update scheduled report: ${error.message}`);
    }

    return mapDbToScheduledReport(updated);
  },
  {
    auth: true,
    schema: UpdateScheduledReportSchema,
  },
);

/**
 * Delete a scheduled report
 */
export const deleteScheduledReportAction = enhanceAction(
  async function (data): Promise<{ success: boolean }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseServerClient() as SupabaseClient<any>;

    const { error } = await client
      .from('scheduled_reports')
      .delete()
      .eq('id', data.id);

    if (error) {
      throw new Error(`Failed to delete scheduled report: ${error.message}`);
    }

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteScheduledReportSchema,
  },
);

/**
 * Get all scheduled reports for an account
 */
export const getScheduledReportsAction = enhanceAction(
  async function (data): Promise<ScheduledReport[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = getSupabaseServerClient() as SupabaseClient<any>;

    const { data: reports, error } = await client
      .from('scheduled_reports')
      .select(
        `
        id, account_id, name, report_type, frequency, metrics, platforms,
        project_ids, branding, recipients, next_run_at, last_run_at,
        last_run_status, last_error, is_active, created_at, updated_at
      `,
      )
      .eq('account_id', data.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch scheduled reports: ${error.message}`);
    }

    return (reports || []).map(mapDbToScheduledReport);
  },
  {
    auth: true,
    schema: GetScheduledReportsSchema,
  },
);

/**
 * Map database row to ScheduledReport type
 */
function mapDbToScheduledReport(row: Record<string, unknown>): ScheduledReport {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    reportType: row.report_type as 'pdf' | 'csv',
    frequency: row.frequency as 'weekly' | 'monthly',
    metrics: row.metrics as ReportMetric[],
    platforms: row.platforms as ReportPlatform[],
    projectIds: row.project_ids as string[] | null,
    branding: row.branding as Branding | null,
    recipients: row.recipients as string[],
    nextRunAt: new Date(row.next_run_at as string),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastRunStatus: row.last_run_status as string | null,
    lastError: row.last_error as string | null,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
