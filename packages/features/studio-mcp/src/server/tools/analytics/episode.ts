import 'server-only';

import { z } from 'zod';

import {
  getEpisodeAnalyticsService,
  getEpisodeRetentionPublishService,
} from '@kit/content-analytics/server/diagnostics-service';
import { getSyncStatusService } from '@kit/content-analytics/server/sync-service';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  requireOwnedEpisode,
  windowOf,
} from './shared';

/**
 * The episode analytics page: the episode's figures across its publishes,
 * each publish's sync record (the "figures last refreshed" line), and the
 * publish the retention drill-down would open.
 */
export const getEpisodeAnalytics = defineTool({
  name: 'get_episode_analytics',
  title: 'Episode analytics',
  description:
    'One episode’s analytics across its publishes, as the episode page shows them, with `freshness` (each publish’s last analytics sync and any failure) and `retentionPublishId` (the YouTube publish get_retention_curve would read, or null).',
  inputSchema: { episodeId: z.string().uuid() },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const { projectId } = await requireOwnedEpisode(context, input.episodeId);
    const client = context.principal.supabase;
    const episode = { episodeId: input.episodeId };

    const [data, freshness, retention, notes] = await Promise.all([
      callService(() => getEpisodeAnalyticsService(client, episode)),
      callService(() => getSyncStatusService(client, episode)),
      callService(() => getEpisodeRetentionPublishService(client, episode)),
      analyticsNotes(context, { projectId }, windowOf({})),
    ]);

    return {
      structuredContent: {
        data,
        freshness,
        retentionPublishId: retention.publishId,
        notes,
      },
    };
  },
});
