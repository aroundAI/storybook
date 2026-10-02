import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { z } from 'zod';

import { ActionRefusal } from '@kit/next/action-result';

import type {
  Branding,
  GeneratedReportRecord,
  ReportMetric,
  ReportPlatform,
  ScheduledReport,
} from '../lib/report-types';
import type {
  GeneratedReportIdSchema,
  GetScheduledReportsSchema,
  ListGeneratedReportsSchema,
} from '../lib/schemas/report.schema';
import type { AnalyticsClient } from './analytics-client';
import {
  findGeneratedReportPath,
  listGeneratedReports,
} from './report-history';
import { signReportUrl } from './report-storage';

/**
 * The report reads as services over the caller's client (FILM-1906):
 * generated-report history, a fresh download link, and the schedules.
 * Access is RLS's: `generated_reports_read` and the scheduled_reports
 * policies decide which rows the caller sees, and a path RLS hides is
 * refused as "not in your history".
 */

export const SIGNED_URL_EXPIRY_SECONDS = 3600;

export type ListGeneratedReportsInput = z.infer<
  typeof ListGeneratedReportsSchema
>;

/** The account's generated reports, newest first, one page at a time. */
export async function listGeneratedReportsService(
  client: AnalyticsClient,
  data: ListGeneratedReportsInput,
): Promise<{ reports: GeneratedReportRecord[]; hasMore: boolean }> {
  return listGeneratedReports(client, data.accountId, {
    limit: data.limit,
    offset: data.offset,
  });
}

export type GeneratedReportIdInput = z.infer<typeof GeneratedReportIdSchema>;

/** A fresh signed link for a report already generated. */
export async function getGeneratedReportDownloadService(
  client: AnalyticsClient,
  data: GeneratedReportIdInput,
): Promise<{ downloadUrl: string; expiresAt: Date }> {
  const path = await findGeneratedReportPath(client, data.id);

  if (!path) {
    throw new ActionRefusal('That report is not in your history.');
  }

  const { url, expiresAt } = await signReportUrl(
    client,
    path,
    SIGNED_URL_EXPIRY_SECONDS,
  );

  return { downloadUrl: url, expiresAt };
}

export type GetScheduledReportsInput = z.infer<
  typeof GetScheduledReportsSchema
>;

/** All scheduled reports for an account. */
export async function getScheduledReportsService(
  client: AnalyticsClient,
  data: GetScheduledReportsInput,
): Promise<ScheduledReport[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = client as SupabaseClient<any>;

  const { data: reports, error } = await untyped
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
}

/**
 * Map database row to ScheduledReport type
 */
export function mapDbToScheduledReport(
  row: Record<string, unknown>,
): ScheduledReport {
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
