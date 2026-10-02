import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { McpScope } from './scopes';

/**
 * Who a tool call runs as (EDD "Auth model"). `supabase` is the only
 * database client a tool handler gets: it carries a 5-minute JWT for
 * `userId`, so every query runs under RLS as that user. There is no
 * service-role client on the principal, by design.
 */
export interface McpPrincipal {
  userId: string;
  /** The team the connection is bound to. */
  accountId: string;
  connectionId: string;
  scopes: McpScope[];
  /** The OAuth client's name, or the personal access token's name. */
  clientName: string;
  supabase: SupabaseClient<Database>;
}
