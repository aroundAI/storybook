import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllByIds } from '@kit/shared/pagination';

/**
 * Where report files live, for both writers: the export action
 * (`exports/<accountId>/…`, user client) and the scheduled-report cron
 * (`exports/<accountId>/scheduled/<reportId>/…`, admin client). Before KB-74
 * the cron wrote `scheduled/<reportId>/…`, which names no account: once the
 * schedule was gone, nothing could say whose the file was.
 *
 * Kept until the account asks, and deleting the account is asking (KB-74,
 * owner decision 2026-09-25, following KB-20): `deleteOrphanedReportFiles`
 * removes the files of accounts that no longer exist.
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

  return signReportUrl(client, path, expiresInSeconds);
}

export async function signReportUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  path: string,
  expiresInSeconds: number,
): Promise<{ url: string; expiresAt: Date }> {
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

export async function removeReportFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  path: string,
): Promise<void> {
  const { error } = await client.storage.from(REPORTS_BUCKET).remove([path]);

  if (error) {
    throw new Error(`Failed to delete report file: ${error.message}`);
  }
}

/** A scheduled report's file, in its account's own folder (KB-74) */
export function scheduledReportPath(
  accountId: string,
  reportId: string,
  filename: string,
  now = Date.now(),
) {
  return `exports/${accountId}/scheduled/${reportId}/${now}-${filename}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_PAGE = 100;
const REMOVE_CHUNK = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>;

/** One level of a folder, every page of it */
async function listFolder(client: AdminClient, prefix: string) {
  const entries: Array<{ name: string; id: string | null }> = [];

  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await client.storage
      .from(REPORTS_BUCKET)
      .list(prefix, {
        limit: LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (error) {
      throw new Error(`Failed to list ${prefix}: ${error.message}`);
    }

    entries.push(...(data ?? []));

    if (!data || data.length < LIST_PAGE) return entries;
  }
}

/** Every file under a folder, at any depth. A folder has no id. */
async function filesUnder(
  client: AdminClient,
  prefix: string,
): Promise<string[]> {
  const entries = await listFolder(client, prefix);
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.id === null)
      .map((folder) => filesUnder(client, `${prefix}/${folder.name}`)),
  );

  return [
    ...entries
      .filter((entry) => entry.id !== null)
      .map((file) => `${prefix}/${file.name}`),
    ...nested.flat(),
  ];
}

/** The folders under `prefix` named by an id that `table` no longer has */
async function orphanedFolders(
  client: AdminClient,
  prefix: 'exports' | 'scheduled',
  table: 'accounts' | 'scheduled_reports',
) {
  const ids = (await listFolder(client, prefix))
    .filter((entry) => entry.id === null && UUID.test(entry.name))
    .map((entry) => entry.name);

  // A failed read throws here, before anything is removed: a lookup that
  // came back empty for want of an answer must not read as "all deleted".
  const existing = await fetchAllByIds<{ id: string }>(
    ids,
    (chunk, from, to) =>
      client
        .from(table)
        .select('id')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    `${table} (report files)`,
  );
  const live = new Set(existing.map((row) => row.id.toLowerCase()));

  return ids
    .filter((id) => !live.has(id.toLowerCase()))
    .map((id) => `${prefix}/${id}`);
}

/**
 * Remove the report files of accounts that no longer exist, and of legacy
 * `scheduled/<reportId>/` folders whose schedule no longer exists (their
 * only link to an account). Run hourly by the scheduled-reports cron, so a
 * deleted account's files go within the 7 days `/data-deletion` promises,
 * whichever way the account was deleted. Throws, having removed nothing more,
 * if it cannot tell which accounts exist; a failed removal is counted.
 */
export async function deleteOrphanedReportFiles(
  client: AdminClient,
): Promise<{ removed: number; failed: number }> {
  const folders = [
    ...(await orphanedFolders(client, 'exports', 'accounts')),
    ...(await orphanedFolders(client, 'scheduled', 'scheduled_reports')),
  ];

  let removed = 0;
  let failed = 0;

  for (const folder of folders) {
    const files = await filesUnder(client, folder);

    for (let i = 0; i < files.length; i += REMOVE_CHUNK) {
      const chunk = files.slice(i, i + REMOVE_CHUNK);
      const { error } = await client.storage.from(REPORTS_BUCKET).remove(chunk);

      if (error) {
        failed += chunk.length;
      } else {
        removed += chunk.length;
      }
    }
  }

  return { removed, failed };
}
