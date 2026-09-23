import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Where report files live, for both writers: the export action
 * (`exports/<accountId>/…`, user client) and the scheduled-report cron
 * (`scheduled/<reportId>/…`, admin client).
 *
 * Reports stay on Supabase Storage whatever STORAGE_PROVIDER says (KB-55,
 * owner decision D2). They hold per-video revenue, so they must be private,
 * and the R2 setup is one bucket that is public by URL: a report there would
 * be readable by anyone with the key, and a presigned download link would
 * hand the key out. The private `reports` bucket keeps them behind RLS
 * (`has_account_access` on the path's account) and short-lived signed URLs.
 * Moving them to R2 means a separate private R2 bucket; change it here.
 */
const REPORTS_BUCKET = 'reports';

export async function storeReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  path: string,
  file: { buffer: Buffer; contentType: string; cacheControl: string },
  expiresInSeconds: number,
): Promise<{ url: string; expiresAt: Date }> {
  const { error: uploadError } = await client.storage
    .from(REPORTS_BUCKET)
    .upload(path, file.buffer, {
      contentType: file.contentType,
      cacheControl: file.cacheControl,
    });

  if (uploadError) {
    throw new Error(`Failed to upload report: ${uploadError.message}`);
  }

  const { data, error: signError } = await client.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (signError || !data) {
    throw new Error(`Failed to create download URL: ${signError?.message}`);
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}
