import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import { ActionRefusal } from '../lib/action-result';
import {
  MAX_REPORT_LIST_DAYS,
  type ReportSummary,
  ReportSummarySchema,
  type SaveProjectReportInput,
} from '../lib/schemas/project-report.schema';

/**
 * FILM-1735. A project's morning report, one per project and day. A job may
 * cover one project or several, so the first save of a day fixes its text:
 * a later save changes nothing and returns the saved report, and every job
 * shows that one. Every read and write runs on the caller's client, so RLS
 * decides whose reports are seen and that a member saves as themself.
 */

type Client = SupabaseClient<Database>;

const COLUMNS =
  'id, account_id, project_id, report_date, timezone, digest_hash, body_md, summary, model, mcp_connection_id, created_by, created_at';

type ReportRow = Database['public']['Tables']['project_daily_reports']['Row'];

export interface ProjectReport {
  id: string;
  projectId: string;
  date: string;
  timezone: string;
  digestHash: string;
  bodyMd: string;
  summary: ReportSummary;
  model: string;
  createdAt: string;
  /** Saved over this MCP connection; null once the connection is deleted */
  mcpConnectionId: string | null;
}

function toReport(row: ReportRow): ProjectReport {
  const summary = ReportSummarySchema.safeParse(row.summary);

  return {
    id: row.id,
    projectId: row.project_id,
    date: row.report_date,
    timezone: row.timezone,
    digestHash: row.digest_hash,
    bodyMd: row.body_md,
    summary: summary.success ? summary.data : {},
    model: row.model,
    createdAt: row.created_at,
    mcpConnectionId: row.mcp_connection_id,
  };
}

export async function getProjectReport(
  client: Client,
  input: { projectId: string; date: string },
): Promise<ProjectReport | null> {
  const { data, error } = await client
    .from('project_daily_reports')
    .select(COLUMNS)
    .eq('project_id', input.projectId)
    .eq('report_date', input.date)
    .maybeSingle();

  if (error) throw new Error(`Could not read the report: ${error.message}`);

  return data ? toReport(data) : null;
}

export type SaveReportResult =
  | { status: 'saved'; report: ProjectReport }
  | { status: 'exists'; report: ProjectReport };

/**
 * Saves the day's report unless the project already has one. Two jobs
 * saving at once meet the unique key: the second's insert fails with
 * 23505 and it answers with the first's report, as if it had come later.
 */
export async function saveProjectReport(
  client: Client,
  input: SaveProjectReportInput & {
    accountId: string;
    mcpConnectionId: string | null;
  },
): Promise<SaveReportResult> {
  const existing = await getProjectReport(client, input);
  if (existing) return { status: 'exists', report: existing };

  const { data, error } = await client
    .from('project_daily_reports')
    .insert({
      account_id: input.accountId,
      project_id: input.projectId,
      report_date: input.date,
      timezone: input.timezone,
      digest_hash: input.digestHash,
      body_md: input.bodyMd,
      summary: input.summary,
      model: input.model,
      mcp_connection_id: input.mcpConnectionId,
    })
    .select(COLUMNS)
    .single();

  if (error?.code === '23505') {
    const saved = await getProjectReport(client, input);
    if (saved) return { status: 'exists', report: saved };
  }

  if (error || !data) {
    throw new Error(`Could not save the report: ${error?.message}`);
  }

  return { status: 'saved', report: toReport(data) };
}

/** A report without its text, for a list */
export type ProjectReportEntry = Omit<ProjectReport, 'bodyMd'> & {
  chars: number;
};

/**
 * The project's reports between two days, inclusive, newest first. With
 * `withBody`, each one's text too (the page renders them); without, its
 * length only.
 */
export async function listProjectReports(
  client: Client,
  input: { projectId: string; from: string; to: string },
): Promise<ProjectReportEntry[]>;
export async function listProjectReports(
  client: Client,
  input: { projectId: string; from: string; to: string; withBody: true },
): Promise<ProjectReport[]>;
export async function listProjectReports(
  client: Client,
  input: { projectId: string; from: string; to: string; withBody?: boolean },
): Promise<Array<ProjectReport | ProjectReportEntry>> {
  const span =
    (Date.parse(`${input.to}T00:00:00Z`) -
      Date.parse(`${input.from}T00:00:00Z`)) /
    86_400_000;

  if (span < 0 || span >= MAX_REPORT_LIST_DAYS) {
    throw new ActionRefusal(
      `List at most ${MAX_REPORT_LIST_DAYS} days of reports, with from on or before to.`,
    );
  }

  const rows = await fetchAllRows<ReportRow>(
    (from, to) =>
      client
        .from('project_daily_reports')
        .select(COLUMNS)
        .eq('project_id', input.projectId)
        .gte('report_date', input.from)
        .lte('report_date', input.to)
        .order('report_date', { ascending: false })
        .range(from, to),
    'project daily reports',
  );

  return rows.map((row) => {
    const report = toReport(row);
    if (input.withBody) return report;

    const { bodyMd, ...entry } = report;
    return { ...entry, chars: bodyMd.length };
  });
}
