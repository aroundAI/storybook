import 'server-only';

import { type SupabaseClient, createClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';
import { getSupabaseClientKeys } from '@kit/supabase/get-supabase-client-keys';

/**
 * A Supabase client that presents a minted user JWT, so PostgREST runs every
 * query under RLS as that user. The public (anon) key is the API key; the
 * JWT is the identity. No session, no refresh: the token outlives the call
 * by minutes and is then gone.
 */
export function createUserScopedClient(jwt: string): SupabaseClient<Database> {
  const keys = getSupabaseClientKeys();

  return createClient<Database>(keys.url, keys.publicKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
