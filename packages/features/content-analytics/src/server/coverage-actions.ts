'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { CoverageMatrixSchema } from '../lib/schemas/coverage.schema';
import { getCoverageMatrixService } from './coverage-service';

/**
 * Coverage for every card on the analytics page, in one call (FILM-1704):
 * the cookie-session wrapper over `getCoverageMatrixService` (FILM-1906).
 */
export const getCoverageMatrixAction = enhanceAction(
  async (input) => getCoverageMatrixService(getSupabaseServerClient(), input),
  {
    schema: CoverageMatrixSchema,
    auth: true,
  },
);
