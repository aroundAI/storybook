import 'server-only';

import { z } from 'zod';

import {
  getChannelExperimentService,
  listChannelExperimentsService,
} from '@kit/content-analytics/server/channel-experiment-service';

import { defineTool } from '../../../registry';
import {
  NOT_MEASURED_REASON,
  READ_ONLY,
  callService,
  pageArgs,
  paginate,
  requireOwnedRow,
} from './shared';

/**
 * Channel experiments (FILM-1724): styles compared across new uploads on
 * one channel. A running experiment's results are computed now; with
 * ClickHouse off they are `{ kind: 'analytics_off' }`, the page's own
 * state, passed through.
 */
export const listChannelExperiments = defineTool({
  name: 'list_channel_experiments',
  title: 'List channel experiments',
  description:
    'The team’s channel experiments (styles compared across new uploads on one channel), newest first, with status, format family and channel. Paged.',
  inputSchema: { ...pageArgs },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const rows = await callService(() =>
      listChannelExperimentsService(context.principal.supabase, {
        accountId: context.accountId,
      }),
    );

    return { structuredContent: { ...paginate(rows, input) } };
  },
});

export const getChannelExperiment = defineTool({
  name: 'get_channel_experiment',
  title: 'Get channel experiment',
  description:
    'One channel experiment: its styles with video counts, the assigned videos, the style the page would suggest next, and `results` — `not_started`, `live` (computed now), `frozen` (as concluded) or `analytics_off`.',
  inputSchema: { experimentId: z.string().uuid() },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    await requireOwnedRow(
      context,
      'channel_experiments',
      input.experimentId,
      'Channel experiment',
    );

    const data = await callService(() =>
      getChannelExperimentService(context.principal.supabase, input),
    );

    return {
      structuredContent: {
        data,
        notes: {
          measured: data.results.kind !== 'analytics_off',
          reason:
            data.results.kind === 'analytics_off' ? NOT_MEASURED_REASON : null,
        },
      },
    };
  },
});
