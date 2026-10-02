'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Out of this file because it is `'use server'`: every export of such a
// module must be an async function, so a schema with a synchronous
// `.refine` cannot live here and stay testable. See traffic.schema.ts.
import { TrafficBreakdownSchema } from '../lib/schemas/traffic.schema';
import {
  BackCatalogSchema,
  CohortCurvesSchema,
  MedianPerformanceSchema,
  ReturningViewerProxySchema,
  RollingViewsSchema,
  YppProgressSchema,
  getBackCatalogService,
  getCohortCurvesService,
  getMedianPerformanceService,
  getReturningViewerProxyService,
  getRollingViewsService,
  getTrafficBreakdownService,
  getYppProgressService,
} from './deep-dive-service';

/**
 * The Deep Dive's actions: each is the cookie-session wrapper over its
 * service in `deep-dive-service.ts` (FILM-1906), which proves the scope and
 * reads ClickHouse.
 */

/**
 * Median (p25/p75/mean alongside) views per video per bucket.
 */
export const getMedianPerformanceAction = enhanceAction(
  async (input) =>
    getMedianPerformanceService(getSupabaseServerClient(), input),
  {
    schema: MedianPerformanceSchema,
    auth: true,
  },
);

/**
 * Rolling 90-day (configurable) view totals.
 */
export const getRollingViewsAction = enhanceAction(
  async (input) => getRollingViewsService(getSupabaseServerClient(), input),
  {
    schema: RollingViewsSchema,
    auth: true,
  },
);

/**
 * Views and watch time per traffic-source group, per bucket (FILM-1605).
 */
export const getTrafficBreakdownAction = enhanceAction(
  async (input) => getTrafficBreakdownService(getSupabaseServerClient(), input),
  {
    schema: TrafficBreakdownSchema,
    auth: true,
  },
);

/**
 * Back-catalog contribution: share of period views from videos older than
 * ageDays, monthly.
 */
export const getBackCatalogAction = enhanceAction(
  async (input) => getBackCatalogService(getSupabaseServerClient(), input),
  {
    schema: BackCatalogSchema,
    auth: true,
  },
);

/**
 * Upload cohorts with the distribution of per-video views at fixed ages,
 * plus growth against the previous cohort.
 */
export const getCohortCurvesAction = enhanceAction(
  async (input) => getCohortCurvesService(getSupabaseServerClient(), input),
  {
    schema: CohortCurvesSchema,
    auth: true,
  },
);

/**
 * Watch-hours and subscriber progress toward the YPP gate, per channel.
 */
export const getYppProgressAction = enhanceAction(
  async (input) => getYppProgressService(getSupabaseServerClient(), input),
  {
    schema: YppProgressSchema,
    auth: true,
  },
);

/**
 * Returning-viewer proxy: subscribed vs non-subscribed share of views.
 */
export const getReturningViewerProxyAction = enhanceAction(
  async (input) =>
    getReturningViewerProxyService(getSupabaseServerClient(), input),
  {
    schema: ReturningViewerProxySchema,
    auth: true,
  },
);
