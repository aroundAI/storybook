import 'server-only';

import { z } from 'zod';

import {
  MAX_REPORT_CHARS,
  MAX_REPORT_LIST_DAYS,
  ReportDay,
  SaveProjectReportSchema,
} from '@kit/content-analytics/lib/schemas/project-report';
import {
  getProjectReport as readProjectReport,
  listProjectReports as readProjectReports,
  saveProjectReport as writeProjectReport,
} from '@kit/content-analytics/server/project-reports';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { READ_ONLY, callService, parseWith, requireTeamScope } from './shared';

/**
 * FILM-1735. A project's morning report: written by the person's own AI
 * from get_daily_digest, saved once per project and day, and read back by
 * every later job that day, so a project's text is the same however the
 * jobs are grouped. The Daily reports tab shows what is saved here.
 */

const projectIdArg = z.string().uuid().describe('A project id.');

export const saveProjectReport = defineTool({
  name: 'save_project_report',
  title: 'Save a project’s morning report',
  description: `Saves your report on one project's day (Markdown, at most ${MAX_REPORT_CHARS} characters), with the \`digestHash\` get_daily_digest returned, the \`timezone\` the day was read in, and the \`model\` that wrote it. The first save of a project's day is kept: if one exists, \`status\` is \`exists\` and the saved report is returned unchanged, and that is the text to show. Otherwise \`status\` is \`saved\`. \`summary\` may carry a one-line \`headline\` and \`dataThrough\` (platform → the last day its data covers), which the page shows above the report.`,
  inputSchema: SaveProjectReportSchema.shape,
  scope: 'studio:write',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const report = parseWith(SaveProjectReportSchema, input);
    await requireTeamScope(context, { projectId: report.projectId });

    const result = await callService(() =>
      writeProjectReport(context.principal.supabase, {
        ...report,
        accountId: context.accountId,
        mcpConnectionId: context.principal.connectionId,
      }),
    );

    return {
      text:
        result.status === 'saved'
          ? `Saved the report for ${report.date}.`
          : `A report for ${report.date} was already saved (by ${result.report.model}); it is unchanged. Show that one.`,
      structuredContent: result,
    };
  },
});

export const getProjectReport = defineTool({
  name: 'get_project_report',
  title: 'A project’s saved morning report',
  description:
    'The report saved for one project and day, or `report: null` when none is. A morning routine calls this first: when a report exists, show its `bodyMd` exactly as saved instead of writing a new one.',
  inputSchema: { projectId: projectIdArg, date: ReportDay },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireTeamScope(context, { projectId: input.projectId });

    const report = await callService(() =>
      readProjectReport(context.principal.supabase, input),
    );

    return { structuredContent: { report } };
  },
});

export const listProjectReports = defineTool({
  name: 'list_project_reports',
  title: 'A project’s saved morning reports',
  description: `The reports saved for one project between \`from\` and \`to\` (inclusive, at most ${MAX_REPORT_LIST_DAYS} days), newest first, without their text: each one's day, timezone, model, summary and length. Read one with get_project_report.`,
  inputSchema: { projectId: projectIdArg, from: ReportDay, to: ReportDay },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    if (input.from > input.to) {
      throw new McpToolError('VALIDATION_FAILED', '`from` is after `to`.');
    }

    await requireTeamScope(context, { projectId: input.projectId });

    const reports = await callService(() =>
      readProjectReports(context.principal.supabase, input),
    );

    return { structuredContent: { projectId: input.projectId, reports } };
  },
});
