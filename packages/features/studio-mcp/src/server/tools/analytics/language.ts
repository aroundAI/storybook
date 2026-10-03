import 'server-only';

import { z } from 'zod';

import {
  GetLanguageAnalyticsSchema,
  GetLanguageDivergenceSchema,
  GetProjectAnalyticsSchema,
  getContentTypeComparisonService,
  getGeographyByLanguageService,
  getLanguageDivergenceService,
  getLanguagePerformanceService,
  getLanguageTrendService,
  getPlatformLanguageMatrixService,
  getShortsSourcePerformanceService,
} from '@kit/content-analytics/server/dashboard-service';

import { defineTool } from '../../../registry';
import {
  READ_ONLY,
  analyticsNotes,
  callService,
  dateRangeArgs,
  parseWith,
  platformArg,
  platformsOf,
  requireTeamScope,
  windowOf,
} from './shared';

export const LANGUAGE_VIEWS = [
  'performance',
  'platform_matrix',
  'content_type',
  'shorts_source',
  'geography',
  'trend',
  'divergence',
] as const;

/** The project dashboard's Language tab, one card per call. */
export const getLanguageAnalytics = defineTool({
  name: 'get_language_analytics',
  title: 'Language analytics',
  description:
    'The Language tab of a project: `performance` per language, the `platform_matrix` (platform × language), `content_type` (Shorts against long-form), `shorts_source`, `geography` by language, the language `trend` over time, or `divergence` (videos in a language other than their channel’s target). `dimension` picks the content language or the channel’s target language.',
  inputSchema: {
    projectId: z.string().uuid(),
    view: z.enum(LANGUAGE_VIEWS),
    dimension: GetLanguageAnalyticsSchema.shape.dimension,
    ...dateRangeArgs,
    platform: platformArg,
  },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const scope = await requireTeamScope(context, {
      projectId: input.projectId,
    });
    const window = windowOf(input);
    const platforms = platformsOf(input.platform);
    const client = context.principal.supabase;
    const range = {
      projectId: input.projectId,
      from: window.fromDate,
      to: window.toDate,
      dimension: input.dimension,
      platforms,
    };

    const [data, notes] = await Promise.all([
      callService(async () => {
        switch (input.view) {
          case 'performance':
            return getLanguagePerformanceService(
              client,
              parseWith(GetLanguageAnalyticsSchema, range),
            );
          case 'platform_matrix':
            return getPlatformLanguageMatrixService(
              client,
              parseWith(GetLanguageAnalyticsSchema, range),
            );
          case 'content_type':
            return getContentTypeComparisonService(
              client,
              parseWith(GetProjectAnalyticsSchema, range),
            );
          case 'shorts_source':
            return getShortsSourcePerformanceService(
              client,
              parseWith(GetLanguageAnalyticsSchema, range),
            );
          case 'geography':
            return getGeographyByLanguageService(
              client,
              parseWith(GetLanguageAnalyticsSchema, range),
            );
          case 'trend':
            return getLanguageTrendService(
              client,
              parseWith(GetLanguageAnalyticsSchema, range),
            );
          case 'divergence':
            return getLanguageDivergenceService(
              client,
              parseWith(GetLanguageDivergenceSchema, {
                projectId: input.projectId,
                platforms,
              }),
            );
        }
      }),
      analyticsNotes(context, { ...scope, platforms }, window),
    ]);

    return { structuredContent: { view: input.view, data, notes } };
  },
});
