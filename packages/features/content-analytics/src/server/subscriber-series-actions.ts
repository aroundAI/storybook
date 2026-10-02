'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  SubscriberSeriesSchema,
  getSubscriberSeriesService,
} from './subscriber-series-service';

/**
 * The reconstructed subscriber curve (FILM-1607): the cookie-session wrapper
 * over `getSubscriberSeriesService` (FILM-1906), which holds the scoping.
 */
export const getSubscriberSeriesAction = enhanceAction(
  async (input) => getSubscriberSeriesService(getSupabaseServerClient(), input),
  { schema: SubscriberSeriesSchema, auth: true },
);
