import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Database queries for assets
export async function getAssetsByProject(projectId: string) {
  const client = getSupabaseServerClient();
  // Implementation will be added
  void client;
  void projectId;
  return { data: [], error: null };
}
