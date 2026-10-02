import 'server-only';

import { z } from 'zod';

import { CoverageMatrixSchema } from '@kit/content-analytics/lib/schemas/coverage';
import {
  ListChannelsSchema,
  listChannelsService,
} from '@kit/content-analytics/server/channels-service';
import { getCoverageMatrixService } from '@kit/content-analytics/server/coverage-service';

import { defineTool } from '../../../registry';
import {
  NOT_MEASURED_REASON,
  READ_ONLY,
  callService,
  channelIdArg,
  dateRangeArgs,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

/**
 * The coverage strip's source (FILM-1704): per metric family and platform,
 * whether the scope is connected, has data in the window, or why it cannot.
 * `observed: false` is ClickHouse off.
 */
export const getDataCoverage = defineTool({
  name: 'get_data_coverage',
  title: 'Data coverage',
  description:
    'What the analytics can and cannot say for a scope and window: per metric family and platform, connected, data in the window, stale, not authorised, not connected, not reported by the platform, or unsupported. `observed: false` means ClickHouse was not read (production’s state), so every observed cell is unknown rather than empty.',
  inputSchema: {
    projectId: z.string().uuid().optional(),
    channelId: channelIdArg,
    platform: platformArg,
    ...dateRangeArgs,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
      channelId: input.channelId,
    });
    const window = windowOf(input);

    const data = await callService(() =>
      getCoverageMatrixService(
        context.principal.supabase,
        parseWith(CoverageMatrixSchema, {
          scope: { ...scope, platforms: platformsOf(input.platform) },
          from: window.from,
          to: window.to,
        }),
      ),
    );

    return {
      structuredContent: {
        data,
        notes: {
          measured: data.observed,
          reason: data.observed ? null : NOT_MEASURED_REASON,
        },
      },
    };
  },
});

export const listChannels = defineTool({
  name: 'list_channels',
  title: 'List channels',
  description:
    'The channels a project publishes to, or every channel connected to the team: connection id, platform, name, whether it is active, its target language and whether its grant reaches the platform’s analytics. Channel ids are what the other tools take as `channelId`.',
  inputSchema: { projectId: z.string().uuid().optional() },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
    });

    const data = await callService(() =>
      listChannelsService(
        context.principal.supabase,
        parseWith(ListChannelsSchema, {
          projectId: scope.projectId,
          accountId: scope.accountId,
        }),
      ),
    );

    return { structuredContent: { data } };
  },
});
