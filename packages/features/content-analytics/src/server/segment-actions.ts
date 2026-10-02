'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  SegmentPerformanceSchema,
  getSegmentPerformanceService,
} from './segment-service';

export type {
  RevenueStatus,
  SegmentPerformanceEntry,
  SegmentPerformanceResult,
} from './segment-service';

/**
 * Per-segment view distribution at a checkpoint age, optionally with a
 * pooled revenue rate: the cookie-session wrapper over
 * `getSegmentPerformanceService` (FILM-1906), which holds the scoping and
 * the cross-store composition.
 */
export const getSegmentPerformanceAction = enhanceAction(
  async (input) =>
    getSegmentPerformanceService(getSupabaseServerClient(), input),
  { schema: SegmentPerformanceSchema, auth: true },
);
