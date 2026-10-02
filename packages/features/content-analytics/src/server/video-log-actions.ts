'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ScopedVideoLogSchema, getVideoLogService } from './video-log-service';

export type { VideoLogRow } from './video-log-service';

/**
 * The per-video Video Log: the cookie-session wrapper over
 * `getVideoLogService` (FILM-1906), which holds the scoping and the reads.
 */
export const getVideoLogAction = enhanceAction(
  async (input) => getVideoLogService(getSupabaseServerClient(), input),
  { schema: ScopedVideoLogSchema, auth: true },
);
