'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  SignalSurfaceSchema,
  getSignalSurfaceService,
} from './signal-surface-service';

export type { SignalSurfaceResult } from './signal-surface-service';

/**
 * One video's funnel at one checkpoint (FILM-1719): the cookie-session
 * wrapper over `getSignalSurfaceService` (FILM-1906).
 */
export const getSignalSurfaceAction = enhanceAction(
  async (input) => getSignalSurfaceService(getSupabaseServerClient(), input),
  { schema: SignalSurfaceSchema, auth: true },
);
