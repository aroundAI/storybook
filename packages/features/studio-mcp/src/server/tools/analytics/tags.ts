import 'server-only';

import { z } from 'zod';

import { ListTagsSchema } from '@kit/content-analytics/lib/schemas/taxonomy';
import {
  SegmentPerformanceSchema,
  getSegmentPerformanceService,
} from '@kit/content-analytics/server/segment-service';
import {
  GetMedianByTagSchema,
  getMedianByTagService,
  listTagsService,
} from '@kit/content-analytics/server/taxonomy-service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  channelIdArg,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

export const TAG_PERFORMANCE_VIEWS = [
  'tags',
  'median_by_tag',
  'segments',
] as const;

/** The tags page (`/studio/analytics/tags`): the taxonomy and what it separates. */
export const getTagPerformance = defineTool({
  name: 'get_tag_performance',
  title: 'Tag performance',
  description:
    'The tags page: `tags` lists the team’s taxonomy (optionally one dimension); `median_by_tag` gives median views at a checkpoint age per tag of one dimension, gated until 30 videos are tagged; `segments` compares segments of one `kind` (tag, language, channel_language, content_type, connection) with optional pooled RPM. Project-scoped with `projectId`, else the whole team.',
  inputSchema: {
    view: z.enum(TAG_PERFORMANCE_VIEWS),
    projectId: z.string().uuid().optional(),
    dimension: GetMedianByTagSchema.shape.dimension
      .optional()
      .describe(
        'tags: filter; median_by_tag: required; segments of kind tag: the tag dimension.',
      ),
    kind: SegmentPerformanceSchema.innerType().shape.kind.default('tag'),
    channelId: channelIdArg,
    platform: platformArg,
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
    channelLanguage: z.string().max(10).optional(),
    checkpointDays: z.number().int().min(1).max(730).default(30),
    minVideos: z
      .number()
      .int()
      .optional()
      .describe('segments: the fewest videos a segment needs (default 5).'),
    includeRevenue: z.boolean().default(false),
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const client = context.principal.supabase;
    const accountId = context.accountId;

    if (input.view === 'tags') {
      const data = await callService(() =>
        listTagsService(
          client,
          parseWith(ListTagsSchema, { accountId, dimension: input.dimension }),
        ),
      );

      return { structuredContent: { view: input.view, data } };
    }

    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
      channelId: input.channelId,
    });
    const platforms = platformsOf(input.platform);
    const window = windowOf({});

    const [data, notes] = await Promise.all([
      callService(async () => {
        if (input.view === 'median_by_tag') {
          if (!input.dimension) {
            throw new McpToolError(
              'VALIDATION_FAILED',
              'median_by_tag needs a tag dimension.',
            );
          }

          return getMedianByTagService(
            client,
            parseWith(GetMedianByTagSchema, {
              accountId,
              projectId: input.projectId,
              dimension: input.dimension,
              checkpointDays: input.checkpointDays,
            }),
          );
        }

        return getSegmentPerformanceService(
          client,
          parseWith(SegmentPerformanceSchema, {
            ...scope,
            contentType: input.contentType,
            language: input.language,
            channelLanguage: input.channelLanguage,
            kind: input.kind,
            dimension: input.dimension,
            minVideos: input.minVideos,
            checkpointDays: input.checkpointDays,
            includeRevenue: input.includeRevenue,
          }),
        );
      }),
      analyticsNotes(context, { ...scope, platforms }, window),
    ]);

    return { structuredContent: { view: input.view, data, notes } };
  },
});
