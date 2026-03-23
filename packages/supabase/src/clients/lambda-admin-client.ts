/**
 * Lambda-Safe Admin Client
 *
 * Creates a Supabase admin client without the `server-only` guard.
 * Use this in Lambda / serverless contexts where `getSupabaseServerAdminClient`
 * cannot be imported (it uses `import 'server-only'` which throws in Lambda).
 *
 * Authentication is by-passed using the service role key — use only for
 * background jobs, analytics logging, and server-side mutations.
 */

import { createClient } from '@supabase/supabase-js';

import { Database } from '../database.types';

/**
 * @name createLambdaAdminClient
 * @description Creates a Supabase admin client using raw env vars.
 * Safe to import in Lambda functions (no server-only restriction).
 * Returns null if env vars are not available rather than throwing.
 */
export function createLambdaAdminClient<GenericSchema = Database>() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient<GenericSchema>(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      detectSessionInUrl: false,
      autoRefreshToken: false,
    },
  });
}
