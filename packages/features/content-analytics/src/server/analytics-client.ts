import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

/**
 * The caller's Supabase client every analytics service reads through
 * (FILM-1906).
 *
 * A service takes it as its first argument instead of building one: the web
 * action passes the cookie-session client, and an MCP tool passes the client
 * minted for its principal. Authorisation does not move — `assertScopeAccess`
 * and RLS both run against whichever client was passed — which is what lets
 * the two entry points share one body of code without either reaching
 * ClickHouse on another tenant's behalf.
 */
export type AnalyticsClient = SupabaseClient<Database>;
