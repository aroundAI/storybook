import 'server-only';

import { z } from 'zod';

import {
  GeneratedReportIdSchema,
  GetScheduledReportsSchema,
  ListGeneratedReportsSchema,
} from '@kit/content-analytics/lib/schemas/report';
import {
  getGeneratedReportDownloadService,
  getScheduledReportsService,
  listGeneratedReportsService,
} from '@kit/content-analytics/server/report-service';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  callService,
  cursorFor,
  cursorOffset,
  pageArgs,
  parseWith,
  requireOwnedRow,
} from './shared';

/**
 * Reports: the generated history and the schedules, read-only. Generating,
 * scheduling and deleting stay in the web app (criterion 9).
 */
export const listReports = defineTool({
  name: 'list_reports',
  title: 'List reports',
  description:
    'The team’s generated reports, newest first and paged (`generated`), and its scheduled reports (`scheduled`). Use get_report_download for a fresh link to a generated one.',
  inputSchema: { ...pageArgs },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const accountId = context.accountId;
    const offset = cursorOffset(input.cursor);

    const [generated, scheduled] = await Promise.all([
      callService(() =>
        listGeneratedReportsService(
          client,
          parseWith(ListGeneratedReportsSchema, {
            accountId,
            limit: input.limit,
            offset,
          }),
        ),
      ),
      callService(() =>
        getScheduledReportsService(
          client,
          parseWith(GetScheduledReportsSchema, { accountId }),
        ),
      ),
    ]);

    return {
      structuredContent: {
        generated: {
          items: generated.reports,
          nextCursor: generated.hasMore
            ? cursorFor(offset + input.limit)
            : null,
        },
        scheduled,
      },
    };
  },
});

export const getReportDownload = defineTool({
  name: 'get_report_download',
  title: 'Report download link',
  description:
    'A fresh signed download link for a generated report in the team’s history, valid for one hour.',
  inputSchema: { reportId: z.string().uuid() },
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'generated_reports',
      input.reportId,
      'Report',
    );

    const data = await callService(() =>
      getGeneratedReportDownloadService(
        context.principal.supabase,
        parseWith(GeneratedReportIdSchema, { id: input.reportId }),
      ),
    );

    return {
      structuredContent: {
        downloadUrl: data.downloadUrl,
        expiresAt: data.expiresAt.toISOString(),
      },
    };
  },
});
