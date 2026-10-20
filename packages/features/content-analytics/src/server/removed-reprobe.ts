import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { PLATFORM_NAMES, isPlatform } from '@kit/publishing/lib/platforms';
import { metaFetch } from '@kit/shared/vendors';
import type { Database, Json } from '@kit/supabase/database';

/**
 * KB-213. A video marked removed by hand may still be live.
 *
 * After the 19 Oct double post, the duplicate rows were marked `deleted`
 * on the owner's word, but at least some stayed on the Facebook Page, and
 * a row marked removed no longer counts toward the duplicate guard or the
 * posting rules. The hourly sync asks the platform again, once a day, about
 * each `deleted` row published in the last 14 days whose removal was not
 * the platform's own not-found (KB-207 writes "not found on …"): a hand
 * mark from the Schedule tab or MCP, or one written directly in the
 * database. Rows of deleted episodes are included; the incident's were.
 *
 * Only a definite answer moves anything. The platform returning the video
 * (YouTube's `videos.list` lists it; Meta answers `GET /{id}` with that id)
 * sets the row back to `published` with `metadata.restoredNote`. A definite
 * not-found records `metadata.reprobedAt`, so the row is asked again a day
 * later. A token, permission, rate-limit or network failure does nothing,
 * and the row is asked again next hour.
 */

type Client = SupabaseClient<Database>;

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ONCE_A_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 100;
const PROBED_PLATFORMS = new Set(['youtube', 'facebook', 'instagram']);

type Answer = 'live' | 'gone' | 'unknown';

export interface ReprobeDeps {
  ensureValidToken: (
    connectionId: string,
  ) => Promise<{ valid: boolean; accessToken?: string }>;
  /** YouTube's `videos.list` ids, or throws */
  youtubeVideoIds: (accessToken: string, ids: string[]) => Promise<Set<string>>;
}

interface RemovedRow {
  id: string;
  platform: string;
  platform_content_id: string | null;
  platform_connection_id: string | null;
  metadata: Json | null;
}

function record(value: unknown): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}

/** Not KB-207's own not-found: a hand mark, however it was written */
export function removedByHand(metadata: unknown): boolean {
  const reason = record(metadata).removedReason;
  return !(typeof reason === 'string' && reason.startsWith('not found on'));
}

function dueForProbe(metadata: unknown, now: Date): boolean {
  const last = record(metadata).reprobedAt;
  if (typeof last !== 'string') return true;
  return now.getTime() - Date.parse(last) >= ONCE_A_DAY_MS;
}

async function probeMeta(id: string, accessToken: string): Promise<Answer> {
  try {
    const response = await metaFetch(`/${encodeURIComponent(id)}?fields=id`, {
      token: accessToken,
    });
    const body = (await response.json().catch(() => null)) as {
      id?: string;
      error?: { code?: number; error_subcode?: number };
    } | null;

    if (response.ok && !body?.error && body?.id === id) return 'live';

    const missing =
      response.status === 404 ||
      (body?.error?.code === 100 && body.error.error_subcode === 33);

    return missing ? 'gone' : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function probe(
  row: RemovedRow & {
    platform_content_id: string;
    platform_connection_id: string;
  },
  deps: ReprobeDeps,
): Promise<Answer> {
  const token = await deps
    .ensureValidToken(row.platform_connection_id)
    .catch(() => null);

  if (!token?.valid || !token.accessToken) return 'unknown';

  if (row.platform === 'youtube') {
    try {
      const ids = await deps.youtubeVideoIds(token.accessToken, [
        row.platform_content_id,
      ]);
      return ids.has(row.platform_content_id) ? 'live' : 'gone';
    } catch {
      return 'unknown';
    }
  }

  return probeMeta(row.platform_content_id, token.accessToken);
}

/**
 * Asks the platforms about hand-marked removals. Returns the rows set back
 * to `published`. Never throws: it runs ahead of the analytics sync, which
 * must not lose a run to it.
 */
export async function reprobeRemovedPublishes(
  client: Client,
  deps: ReprobeDeps,
  now = new Date(),
): Promise<string[]> {
  const restored: string[] = [];

  try {
    const { data, error } = await client
      .from('publishes')
      .select(
        'id, platform, platform_content_id, platform_connection_id, metadata',
      )
      .eq('status', 'deleted')
      .gte('published_at', new Date(now.getTime() - WINDOW_MS).toISOString())
      .not('platform_content_id', 'is', null)
      .order('id')
      .limit(MAX_PER_RUN);

    if (error) return restored;

    const due = ((data ?? []) as RemovedRow[]).filter(
      (row) =>
        PROBED_PLATFORMS.has(row.platform) &&
        row.platform_content_id &&
        row.platform_connection_id &&
        removedByHand(row.metadata) &&
        dueForProbe(row.metadata, now),
    );

    for (const row of due) {
      const answer = await probe(
        row as RemovedRow & {
          platform_content_id: string;
          platform_connection_id: string;
        },
        deps,
      );

      if (answer === 'unknown') continue;

      const metadata = record(row.metadata);
      const at = now.toISOString();

      if (answer === 'gone') {
        await client
          .from('publishes')
          .update({ metadata: { ...metadata, reprobedAt: at } })
          .eq('id', row.id)
          .eq('status', 'deleted');
        continue;
      }

      const {
        removedAt: _removedAt,
        removedReason: _removedReason,
        ...kept
      } = metadata;
      const name = isPlatform(row.platform)
        ? PLATFORM_NAMES[row.platform]
        : row.platform;

      const { data: updated } = await client
        .from('publishes')
        .update({
          status: 'published',
          metadata: {
            ...kept,
            reprobedAt: at,
            restoredNote: `still live on ${name} at ${at}; it had been marked removed`,
          },
        })
        .eq('id', row.id)
        .eq('status', 'deleted')
        .select('id');

      if (updated?.length) restored.push(row.id);
    }
  } catch {
    // Asked again next run
  }

  return restored;
}
