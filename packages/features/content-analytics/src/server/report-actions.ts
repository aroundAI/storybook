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

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { generateSummaryCSV } from '../lib/csv-generator';
import { generatePDFReport } from '../lib/pdf-generator';
import type {
  AnalyticsDataRow,
  Branding,
  DatePreset,
  GeneratedReport,
  ReportMetric,
  ReportPlatform,
  ReportSummary,
  ScheduledReport,
} from '../lib/report-types';
import {
  CreateScheduledReportSchema,
  DeleteScheduledReportSchema,
  GenerateReportSchema,
  GetScheduledReportsSchema,
  UpdateScheduledReportSchema,
} from '../lib/schemas/report.schema';

const REPORTS_BUCKET = 'reports';
const SIGNED_URL_EXPIRY_SECONDS = 3600;

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
 * Fetch analytics data for report
 */
async function fetchAnalyticsData(
  accountId: string,
  dateRange: { start: Date; end: Date },
  platforms: string[],
  projectIds?: string[],
): Promise<AnalyticsDataRow[]> {
  const client = getSupabaseServerClient();

  let query = client
    .from('content_analytics')
    .select(
      `
      id,
      snapshot_date,
      views,
      likes,
      comments,
      shares,
      watch_time_seconds,
      subscribers_gained,
      revenue_cents,
      retention_data,
      publishes!inner (
        id,
        platform,
        title,
        episodes!inner (
          title,
          projects!inner (
            id,
            name,
            account_id
          )
        )
      )
    `,
    )
    .gte('snapshot_date', dateRange.start.toISOString().split('T')[0])
    .lte('snapshot_date', dateRange.end.toISOString().split('T')[0])
    .in('publishes.platform', platforms)
    .eq('publishes.episodes.projects.account_id', accountId)
    .order('views', { ascending: false });

  if (projectIds && projectIds.length > 0) {
    query = query.in('publishes.episodes.projects.id', projectIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch analytics: ${error.message}`);
  }

  return (data || []).map((row) => ({
    snapshotDate: row.snapshot_date,
    platform: (row.publishes as { platform: string }).platform,
    contentTitle:
      (row.publishes as { title: string | null }).title ||
      (
        row.publishes as {
          episodes: { title: string };
        }
      ).episodes.title,
    projectName: (
      row.publishes as {
        episodes: { projects: { name: string } };
      }
    ).episodes.projects.name,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    watchTimeSeconds: row.watch_time_seconds,
    subscribersGained: row.subscribers_gained,
    revenueCents: row.revenue_cents,
    retentionData: row.retention_data as Record<string, number> | null,
  }));
}

/**
 * Calculate report summary from data
 */
function calculateSummary(data: AnalyticsDataRow[]): ReportSummary {
  const platformBreakdown: Record<string, number> = {};

  const totals = data.reduce(
    (acc, row) => {
      platformBreakdown[row.platform] =
        (platformBreakdown[row.platform] || 0) + row.views;

      return {
        totalViews: acc.totalViews + row.views,
        totalLikes: acc.totalLikes + row.likes,
        totalComments: acc.totalComments + row.comments,
        totalShares: acc.totalShares + row.shares,
        totalWatchTimeSeconds: acc.totalWatchTimeSeconds + row.watchTimeSeconds,
        totalSubscribers: acc.totalSubscribers + row.subscribersGained,
        totalRevenueCents: acc.totalRevenueCents + row.revenueCents,
      };
    },
    {
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalWatchTimeSeconds: 0,
      totalSubscribers: 0,
      totalRevenueCents: 0,
    },
  );

  return {
    ...totals,
    contentCount: new Set(data.map((d) => d.contentTitle)).size,
    platformBreakdown,
  };
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
  const client = getSupabaseServerClient();

  const path = `exports/${accountId}/${Date.now()}-${filename}`;

  const { error: uploadError } = await client.storage
    .from(REPORTS_BUCKET)
    .upload(path, buffer, {
      contentType,
      cacheControl: '3600',
    });

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`);
  }

  const { data: signedUrlData, error: signedUrlError } = await client.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedUrlError || !signedUrlData) {
    throw new Error(
      `Failed to create download URL: ${signedUrlError?.message}`,
    );
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000);

  return { url: signedUrlData.signedUrl, expiresAt };
}

/**
 * Generate and return a report with signed download URL
 */
export const generateReportAction = enhanceAction(
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
    );

    if (analyticsData.length === 0) {
      throw new Error('No data found for the selected date range and filters');
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
      const summary = calculateSummary(analyticsData);
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
      .select('*')
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
