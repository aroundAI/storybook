import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '~/lib/database.types';

/**
 * FILM-2003: a StorybookStudio render left uploading for 24 hours was never
 * finalized (the Studio crashed, lost its network or gave up).
 * `expire_stale_render_uploads()` fails it with that reason, so the edit
 * record shows it and deliver_edit refuses it. Runs in the hourly cron.
 */
export async function expireStaleRenderUploads(
  admin: SupabaseClient<Database>,
): Promise<{ ok: true; failed: number } | { ok: false; error: unknown }> {
  const { data, error } = await admin.rpc('expire_stale_render_uploads');

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, failed: data ?? 0 };
}
