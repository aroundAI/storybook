import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isPlatform } from '@kit/publishing/lib/platforms';
import { ALL_ANALYTICS_SCOPES_ENABLED } from '@kit/publishing/oauth/analytics-scope-switch';
import {
  type AnalyticsAccess,
  resolveAnalyticsAccess,
} from '@kit/publishing/oauth/analytics-scopes';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** A channel a project or account publishes to. */
export interface ChannelRef {
  connectionId: string;
  platform: string;
  name: string;
  thumbnailUrl: string | null;
  isActive: boolean;
  /** The channel's target language (`platform_connections.language`). */
  language: string;
  /**
   * Whether the grant reaches its platform's analytics (FILM-1711), so the
   * coverage strip can tell "not authorised" from "no data in the window"
   * (FILM-1705). `null` for a platform analytics has no requirement for.
   */
  analyticsAccess: AnalyticsAccess['summary'] | null;
}

interface ConnectionRow {
  id: string;
  platform: string;
  platform_account_name: string | null;
  is_active: boolean | null;
  metadata: { thumbnail_url?: string } | null;
  language: string;
  scopes?: string[] | null;
}

function toChannelRef(row: ConnectionRow): ChannelRef {
  return {
    connectionId: row.id,
    platform: row.platform,
    name: row.platform_account_name ?? row.platform,
    thumbnailUrl: row.metadata?.thumbnail_url ?? null,
    isActive: row.is_active ?? false,
    language: row.language,
    // The summary does not depend on which scopes our connect requests ask
    // for — that switch only chooses among the ways of *not* holding one —
    // so any switch gives this answer, and no server setting is read here.
    analyticsAccess:
      resolveAnalyticsAccess({
        platform: row.platform,
        grantedScopes: row.scopes,
        metadata: row.metadata,
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      })?.summary ?? null,
  };
}

/**
 * Channels a project actually publishes to.
 *
 * A project spans several channels — different platforms, and separate
 * per-language channels where multi-language audio is unavailable — so this
 * is derived from the project's published content rather than from the
 * account's full connection list, which would include channels this project
 * has never touched.
 */
export async function listProjectChannels(
  projectId: string,
  client: Client = getSupabaseServerClient(),
): Promise<ChannelRef[]> {
  // Two steps rather than one embedded join. The join returns one row per
  // publish, so a project with more publishes than PostgREST's `max_rows`
  // could lose a channel whose only publishes fall past the cut — and the
  // truncation arrives as a short 200, not an error. Collecting the ids
  // first keeps the second query proportional to the channel count, and
  // drops the cast the embedded shape forced.
  // `id` is the tie-breaker, not a column anything reads: offset paging needs
  // a unique order, and `platform_connection_id` repeats once per publish, so
  // rows sharing one could come back in a different order per request.
  const publishRows = await fetchAllRows<{
    id: string;
    platform_connection_id: string | null;
  }>(
    (from, to) =>
      client
        .from('publishes')
        .select('id, platform_connection_id, episodes!inner(project_id)')
        .eq('status', 'published')
        .eq('episodes.project_id', projectId)
        .not('platform_connection_id', 'is', null)
        .order('platform_connection_id')
        .order('id')
        .range(from, to),
    'project channels',
  );

  const connectionIds = Array.from(
    new Set(
      publishRows
        .map((row) => row.platform_connection_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (connectionIds.length === 0) return [];

  const connections = await fetchAllByIds<ConnectionRow>(
    connectionIds,
    (chunk, from, to) =>
      client
        .from('platform_connections')
        .select(
          'id, platform, platform_account_name, is_active, metadata, language, scopes',
        )
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'platform_connections',
  );

  return supported(connections);
}

/**
 * Every channel connected to an account, whether or not it has published
 * anything yet — the right list for settings and for YPP, which applies to
 * a channel regardless of what has been posted to it.
 */
export async function listAccountChannels(
  accountId: string,
  client: Client = getSupabaseServerClient(),
  options?: { platform?: string; activeOnly?: boolean },
): Promise<ChannelRef[]> {
  const connections = await fetchAllRows<ConnectionRow>((from, to) => {
    let query = client
      .from('platform_connections')
      .select(
        'id, platform, platform_account_name, is_active, metadata, language, scopes',
      )
      .eq('account_id', accountId);

    if (options?.platform) {
      query = query.eq('platform', options.platform);
    }
    if (options?.activeOnly) {
      query = query.eq('is_active', true);
    }

    return query.order('id').range(from, to);
  }, 'account channels');

  return supported(connections);
}

/**
 * The rows as channels, leaving out a kept row on a platform the product
 * removed (FILM-717): it is not a channel anyone can see or publish to.
 */
function supported(rows: ConnectionRow[]): ChannelRef[] {
  return rows
    .filter((row) => isPlatform(row.platform))
    .map(toChannelRef)
    .sort((a, b) => a.name.localeCompare(b.name));
}
