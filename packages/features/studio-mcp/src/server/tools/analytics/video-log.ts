import 'server-only';

import { z } from 'zod';

import { getSyncStatusService } from '@kit/content-analytics/server/sync-service';
import {
  ScopedVideoLogSchema,
  getVideoLogService,
} from '@kit/content-analytics/server/video-log-service';

import { defineTool } from '../../../registry';
import {
  CalendarDay,
  READ_ONLY,
  analyticsNotes,
  callService,
  channelIdArg,
  cursorFor,
  cursorOffset,
  pageArgs,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

/**
 * The Video Log: one row per video with views at fixed ages, the quality
 * columns, revenue per currency and the analytics note, plus each row's
 * sync record (when its figures were last refreshed), as the page shows
 * beside it.
 */
export const getVideoLog = defineTool({
  name: 'get_video_log',
  title: 'Video log',
  description:
    'The Video Log for a project or the whole team: per video, views at checkpoint ages (with whether each age has elapsed and whether its window predates ingest), impressions, CTR, average view duration, revenue per currency and the analytics note. `freshness` carries each row’s last sync. Paged with `cursor` and `limit`.',
  inputSchema: {
    projectId: z.string().uuid().optional(),
    channelId: channelIdArg,
    platform: platformArg,
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
    publishedFrom: CalendarDay.optional(),
    publishedTo: CalendarDay.optional(),
    checkpoints: z
      .array(z.number().int())
      .optional()
      .describe('Ages in days, default 30, 90, 180, 365.'),
    orderBy: z.enum(['published_at', 'lifetime_views', 'title']).optional(),
    orderDirection: z.enum(['asc', 'desc']).optional(),
    ...pageArgs,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
      channelId: input.channelId,
    });
    const platforms = platformsOf(input.platform);
    const offset = cursorOffset(input.cursor);
    const client = context.principal.supabase;
    const window = windowOf({
      from: input.publishedFrom,
      to: input.publishedTo,
    });

    const [rows, notes] = await Promise.all([
      callService(() =>
        getVideoLogService(
          client,
          parseWith(ScopedVideoLogSchema, {
            ...scope,
            platforms,
            contentType: input.contentType,
            language: input.language,
            publishedFrom: input.publishedFrom,
            publishedTo: input.publishedTo,
            checkpoints: input.checkpoints,
            limit: input.limit,
            offset,
            orderBy: input.orderBy,
            orderDirection: input.orderDirection,
          }),
        ),
      ),
      analyticsNotes(context, { ...scope, platforms }, window),
    ]);

    const freshness =
      rows.length === 0
        ? []
        : await callService(() =>
            getSyncStatusService(client, {
              publishIds: rows.map((row) => row.videoId),
            }),
          );

    return {
      structuredContent: {
        data: rows,
        freshness,
        nextCursor:
          rows.length === input.limit ? cursorFor(offset + input.limit) : null,
        notes,
      },
    };
  },
});
