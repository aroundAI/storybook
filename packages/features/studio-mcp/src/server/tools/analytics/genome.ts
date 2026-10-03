import 'server-only';

import { z } from 'zod';

import {
  GenomeFindingsSchema,
  getGenomeFindingsService,
} from '@kit/content-analytics/server/genome-service';

import { defineTool } from '../../../registry';
import {
  NOT_MEASURED_REASON,
  READ_ONLY,
  callService,
  parseWith,
  requireTeamScope,
} from './shared';

/**
 * FILM-1717's genome: which creative mechanisms separate one channel's
 * winners from its comparable losers at one funnel stage. No web page reads
 * it yet; the service's refusals (`analytics_off`, a stage the platform
 * cannot fill, a platform not analysed) are passed through by name.
 */
export const getGenomeFindings = defineTool({
  name: 'get_genome_findings',
  title: 'Genome findings',
  description:
    'Content-genome findings for one channel, format family and funnel stage: which tagged mechanisms separate winners from comparable losers, with evidence, claim strength, linked tests, and what the stage’s rate divided by. `status` is `analysed` or `refused` with the refusal’s kind (analytics_off, a stage the platform cannot measure, a platform not analysed).',
  inputSchema: {
    channelId: z
      .string()
      .uuid()
      .describe('One channel: the genome never compares across creators.'),
    formatFamily: GenomeFindingsSchema.shape.formatFamily,
    stage: GenomeFindingsSchema.shape.stage,
    checkpointDays: GenomeFindingsSchema.shape.checkpointDays,
    control: GenomeFindingsSchema.shape.control,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireTeamScope(context, { channelId: input.channelId });

    const data = await callService(() =>
      getGenomeFindingsService(
        context.principal.supabase,
        parseWith(GenomeFindingsSchema, {
          accountId: context.accountId,
          connectionId: input.channelId,
          formatFamily: input.formatFamily,
          stage: input.stage,
          checkpointDays: input.checkpointDays,
          control: input.control,
        }),
      ),
    );

    const off =
      data.status === 'refused' && data.refusal.kind === 'analytics_off';

    return {
      structuredContent: {
        data,
        notes: { measured: !off, reason: off ? NOT_MEASURED_REASON : null },
      },
    };
  },
});
