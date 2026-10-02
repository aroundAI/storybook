'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ListChannelsSchema, listChannelsService } from './channels-service';

/**
 * The channels a project publishes to, or an account's channels, for the
 * Deep Dive channel filter (FILM-1611).
 *
 * `channels.ts` is `server-only` with no `'use server'`, so a client component
 * cannot call its listers directly — this is the entry point, not a second
 * copy: the cookie-session wrapper over `listChannelsService` (FILM-1906).
 */
export const listChannelsAction = enhanceAction(
  async (input) => listChannelsService(getSupabaseServerClient(), input),
  {
    schema: ListChannelsSchema,
    auth: true,
  },
);
