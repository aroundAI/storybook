import { createBrowserClient } from '@supabase/ssr';

import { Database } from '../database.types';
import { getSupabaseClientKeys } from '../get-supabase-client-keys';

/**
 * @name getSupabaseBrowserClient
 * @description Get a Supabase client for use in the Browser
 */
export function getSupabaseBrowserClient<GenericSchema = Database>() {
  const keys = getSupabaseClientKeys();

  const client = createBrowserClient<GenericSchema>(keys.url, keys.publicKey);

  // The app never completes a login by reading the page URL: the PKCE code is
  // exchanged on /auth/callback, server-side. With detection on, auth-js
  // treats any page carrying `error_description` as a failed login and clears
  // the session cookie (KB-176). `createBrowserClient` forces
  // `detectSessionInUrl` on whatever options say, so it is turned off here,
  // before auth-js's async initialisation reads it.
  Object.assign(client.auth, { detectSessionInUrl: false });

  return client;
}
