import 'server-only';

import { z } from 'zod';

import {
  ReportDay,
  ReportTimeZone,
} from '@kit/content-analytics/lib/schemas/project-report';
import { getDailyDigestService } from '@kit/content-analytics/server/daily-digest';

import { defineTool } from '../../../registry';
import { READ_ONLY, callService, requireTeamScope } from './shared';

/**
 * FILM-1735. The facts of one project's day, for a morning report: the
 * same input gives the same digest and `digestHash`, whoever asks and
 * however many projects their job covers.
 */
export const getDailyDigest = defineTool({
  name: 'get_daily_digest',
  title: 'A project’s day, for a morning report',
  description: `Everything about one project's day that a morning report needs, in a fixed order: \`freshness\` (each channel's latest data day and last sync, and any failure or reconnect needed); \`channels\` (each channel's day against the mean of the previous 7 and 28 days); \`videos\` (every video active that day or under 30 days old: the day's and lifetime figures by source, and its views at 1, 7 and 28 days old); \`retention\` (videos under 7 days old against the channel's median); \`traffic\` and \`audience\`; \`comments\` (the day's new comments per video, labelled or not, the unlabelled ids, unanswered questions, and each video's reaction); \`publishing\` (what went out, failed or is held, the next 3 days, and each channel's last scheduled long video); \`revenue\` where granted. The day runs from midnight to midnight in \`timezone\`; platform figures are by the platform's own data day. A figure is a number or null, and every null is listed in its row's \`notMeasured\` with the reason: never read a null as 0. Comment figures for YouTube carry \`disclosure\`, which must be shown with them. Descriptive only: no figure here says why another moved. Save the report you write from it with save_project_report, passing \`digestHash\`.`,
  inputSchema: {
    projectId: z.string().uuid().describe('A project id.'),
    date: ReportDay.describe('The day to report on, YYYY-MM-DD.'),
    timezone: ReportTimeZone.describe(
      'The IANA zone the day is read in, e.g. Asia/Kolkata.',
    ),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireTeamScope(context, { projectId: input.projectId });

    const { digest, digestHash } = await callService(() =>
      getDailyDigestService(context.principal.supabase, input),
    );

    return {
      structuredContent: {
        digest,
        digestHash,
        // Outside the hash: when this copy was read
        generatedAt: new Date().toISOString(),
      },
    };
  },
});
