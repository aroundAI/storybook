'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  EpisodeAnalyticsSchema,
  RetentionCurveSchema,
  WeeklyDiagnosticsSchema,
} from '../lib/schemas/diagnostics.schema';
import {
  getEpisodeAnalyticsService,
  getEpisodeRetentionPublishService,
  getRetentionCurveService,
  getWeeklyDiagnosticsService,
} from './diagnostics-service';
import { withRefusals } from './with-refusals';

/**
 * The diagnostics actions (FILM-1616): each is the cookie-session wrapper
 * over its service in `diagnostics-service.ts` (FILM-1906), which holds the
 * logic, the access checks and the reasoning behind them.
 */

/**
 * Recently published videos with the numbers that say whether something
 * broke this week.
 */
export const getWeeklyDiagnosticsAction = withRefusals(
  'load the weekly diagnostics',
  enhanceAction(
    async (input) =>
      getWeeklyDiagnosticsService(getSupabaseServerClient(), input),
    { schema: WeeklyDiagnosticsSchema },
  ),
);

/**
 * One video's retention curve, for the drill-down (§2).
 */
export const getRetentionCurveAction = withRefusals(
  'load the retention curve',
  enhanceAction(
    async (input) => getRetentionCurveService(getSupabaseServerClient(), input),
    { schema: RetentionCurveSchema },
  ),
);

/**
 * One episode's analytics, for the episode page.
 */
export const getEpisodeAnalyticsAction = withRefusals(
  'load the episode analytics',
  enhanceAction(
    async (input) =>
      getEpisodeAnalyticsService(getSupabaseServerClient(), input),
    { schema: EpisodeAnalyticsSchema },
  ),
);

/**
 * The episode's YouTube publish, if it has one — the id the retention
 * drill-down needs.
 */
export const getEpisodeRetentionPublishAction = withRefusals(
  "find the episode's video",
  enhanceAction(
    async (input) =>
      getEpisodeRetentionPublishService(getSupabaseServerClient(), input),
    { schema: EpisodeAnalyticsSchema },
  ),
);
