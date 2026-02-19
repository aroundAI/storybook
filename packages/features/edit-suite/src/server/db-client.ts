'use server';

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

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Re-export Database type for convenience
export type { Database } from '@kit/supabase/database';

/**
 * Extended Supabase client type that includes edit suite tables.
 *
 * Uses the base SupabaseClient type which provides full query builder
 * support for `.from()`, `.rpc()`, etc. without needing `as any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EditSuiteClient = SupabaseClient<any, 'public', any>;

/**
 * Get a typed Supabase server client for edit suite operations.
 *
 * This is the single point where we handle the type gap between
 * generated types and our new tables. All server actions should
 * use this instead of `getSupabaseServerClient()` directly.
 */
export function getEditSuiteClient(): EditSuiteClient {
    return getSupabaseServerClient() as EditSuiteClient;
}
