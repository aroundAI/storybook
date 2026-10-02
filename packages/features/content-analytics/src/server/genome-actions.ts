'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  GenomeFindingsSchema,
  getGenomeFindingsService,
} from './genome-service';

export type { GenomeFindingsResult, GenomeRefusal } from './genome-service';

/**
 * Which creative mechanisms separate one channel's winners from its
 * comparable losers at one funnel stage (FILM-1717): the cookie-session
 * wrapper over `getGenomeFindingsService` (FILM-1906).
 */
export const getGenomeFindingsAction = enhanceAction(
  async (input) => getGenomeFindingsService(getSupabaseServerClient(), input),
  { schema: GenomeFindingsSchema, auth: true },
);
