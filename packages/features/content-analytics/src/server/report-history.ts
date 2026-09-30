import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

import type { GeneratedReportRecord } from '../lib/report-types';

type Client = SupabaseClient<Database>;

const HISTORY_COLUMNS =
  'id, report_type, file_name, date_range_start, date_range_end, record_count, created_at';

interface HistoryRow {
  id: string;
  report_type: string;
  file_name: string;
  date_range_start: string;
  date_range_end: string;
  record_count: number;
  created_at: string;
}

function toRecord(row: HistoryRow): GeneratedReportRecord {
  return {
    id: row.id,
    reportType: row.report_type === 'csv' ? 'csv' : 'pdf',
    fileName: row.file_name,
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    recordCount: row.record_count,
    createdAt: row.created_at,
  };
}

export interface NewGeneratedReport {
  accountId: string;
  createdBy: string;
  reportType: 'pdf' | 'csv';
  fileName: string;
  storagePath: string;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  recordCount: number;
  config: Json;
}

const day = (date: Date) => date.toISOString().split('T')[0]!;

export async function recordGeneratedReport(
  client: Client,
  report: NewGeneratedReport,
): Promise<void> {
  const { error } = await client.from('generated_reports').insert({
    account_id: report.accountId,
    created_by: report.createdBy,
    report_type: report.reportType,
    file_name: report.fileName,
    storage_path: report.storagePath,
    date_range_start: day(report.dateRangeStart),
    date_range_end: day(report.dateRangeEnd),
    record_count: report.recordCount,
    config: report.config,
  });

  if (error) {
    throw new Error(`Failed to record report history: ${error.message}`);
  }
}

export async function listGeneratedReports(
  client: Client,
  accountId: string,
  page: { limit: number; offset: number },
): Promise<{ reports: GeneratedReportRecord[]; hasMore: boolean }> {
  const { data, error } = await client
    .from('generated_reports')
    .select(HISTORY_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new Error(`Failed to fetch report history: ${error.message}`);
  }

  const rows = data ?? [];

  return {
    reports: rows.slice(0, page.limit).map(toRecord),
    hasMore: rows.length > page.limit,
  };
}

/** The row's file path, read through the caller's RLS; null when not theirs */
export async function findGeneratedReportPath(
  client: Client,
  id: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('generated_reports')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read report history: ${error.message}`);
  }

  return data?.storage_path ?? null;
}

export async function deleteGeneratedReportRow(
  client: Client,
  id: string,
): Promise<number> {
  const { data, error } = await client
    .from('generated_reports')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete report history: ${error.message}`);
  }

  return data?.length ?? 0;
}
