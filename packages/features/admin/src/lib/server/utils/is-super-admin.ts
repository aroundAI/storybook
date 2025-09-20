import { SupabaseClient } from '@supabase/supabase-js';

import { Database } from '@kit/supabase/database';

/**
 * @name isSuperAdmin
 * @description Check if the current user is a super admin.
 * @param client
 */
export async function isSuperAdmin(client: SupabaseClient<Database>) {
  try {
    const { data, error } = await client.rpc('is_super_admin');

    if (error) {
      throw error;
    }

    return data;
  } catch {
    return false;
  }
}
