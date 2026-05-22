import 'server-only';

/**
 * Typed wrapper around Supabase server client for edit suite tables.
 *
 * The Supabase TypeScript types are generated from the database schema,
 * but new tables added via migrations may not yet be in the generated types.
 * This module centralizes the type workaround so we don't scatter
 * `(client as any)` throughout every action file.
 *
 * Once `pnpm supabase:web:typegen` is run and the generated types include
 * these tables, this wrapper can be simplified to use the typed client directly.
 */

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Get a Supabase server client for edit suite operations.
 *
 * Returns the client typed as `any` so that `.from()` and `.rpc()` calls
 * for tables/functions not yet in the generated types don't resolve to `never`.
 *
 * This is the single point where we handle the type gap between
 * generated types and our new tables. All server actions should
 * use this instead of `getSupabaseServerClient()` directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEditSuiteClient(): any {
  return getSupabaseServerClient();
}
