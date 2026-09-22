import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';
import { fetchAllRows } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { ASSET_DURATION_PLATFORMS } from '../lib/asset-duration';
import type { AssetDurationPlatform } from '../lib/asset-duration';
import {
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
  createTikTokAnalyticsProvider,
} from '../providers/tiktok';
import { createYouTubeAnalyticsProvider } from '../providers/youtube';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * The single writer of `publishes.duration_seconds` (FILM-1710).
 *
 * One writer on purpose. A nullable column filled by only some of several
 * paths is the defect `revenue_cents` had — literal 0 in every writer,
 * silent and invisible in tests. Both callers come through here: the hourly
 * sync, for the publishes it is about to sync, and the one-off backfill, for
 * everything published before the column existed.
 *
 * It only ever fills a null. A duration is a fact about an uploaded file, so
 * once a provider has reported one there is nothing to refresh, and asking
 * again would spend quota to rewrite the same number.
 */

/** A published row a provider can be asked about. */
export interface AssetDurationCandidate {
  id: string;
  platform: string;
  platform_connection_id: string | null;
  platform_content_id: string | null;
}

/**
 * Why a publish a provider was (or would have been) asked about still has
 * no duration. Every one of them leaves the row `duration_unknown`; none of
 * them writes a number.
 */
export type AssetDurationGap =
  /** No connection to take a token from — legacy rows, manual uploads. */
  | 'no_connection'
  /** The connection's token could not be validated or refreshed. */
  | 'token_invalid'
  /**
   * The connection lacks the scope the request needs. Every TikTok
   * connection, until FILM-1711 adds `video.list`.
   */
  | 'scope_missing'
  | 'rate_limited'
  /** The request failed for a reason that is not one of the above. */
  | 'provider_error'
  /** The provider reported one and Postgres refused the write. */
  | 'write_failed'
  /**
   * The provider answered and did not include it: deleted, private, or a
   * live broadcast with no finished length.
   */
  | 'not_reported';

export interface AssetDurationSyncResult {
  /** Publishes examined. */
  candidates: number;
  /** Durations written to `publishes.duration_seconds`. */
  written: number;
  /** Publishes left null, by reason. */
  gaps: Partial<Record<AssetDurationGap, number>>;
  /** Ids whose duration was written, for the dim re-upsert. */
  writtenIds: string[];
  dryRun: boolean;
}

interface TokenValidationResult {
  valid: boolean;
  accessToken?: string;
  error?: string;
}

type EnsureValidToken = (
  connectionId: string,
) => Promise<TokenValidationResult>;

type DurationFetcher = (
  accessToken: string,
  videoIds: string[],
) => Promise<Map<string, number>>;

const FETCHERS: Record<AssetDurationPlatform, DurationFetcher> = {
  youtube: (accessToken, videoIds) =>
    createYouTubeAnalyticsProvider(accessToken).getVideoDurations(videoIds),
  tiktok: (accessToken, videoIds) =>
    createTikTokAnalyticsProvider(accessToken).getVideoDurations(videoIds),
};

function isAssetDurationPlatform(
  platform: string,
): platform is AssetDurationPlatform {
  return (ASSET_DURATION_PLATFORMS as readonly string[]).includes(platform);
}

/** Dynamic, as in analytics-sync-cron: `@kit/publishing` imports this package. */
async function loadEnsureValidToken(): Promise<EnsureValidToken> {
  const { ensureValidToken } = await import('@kit/publishing/token-refresh');

  return ensureValidToken;
}

function classifyFailure(error: unknown): AssetDurationGap {
  if (error instanceof TikTokAnalyticsScopeError) return 'scope_missing';
  if (error instanceof TikTokRateLimitError) return 'rate_limited';

  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('insufficient') || message.includes('forbidden')) {
    return 'scope_missing';
  }

  if (message.includes('quota') || message.includes('rate limit')) {
    return 'rate_limited';
  }

  return 'provider_error';
}

/**
 * Asks each publish's provider for its duration and writes what comes back.
 *
 * Grouped by connection, because the token is the connection's and both
 * providers batch ids — one YouTube call covers 50 publishes for 1 quota
 * unit. A failure is contained to its connection and recorded as a gap: a
 * duration is never worth failing the metric sync that called this.
 *
 * Instagram candidates are ignored rather than counted. Meta has no duration
 * field, so there is nothing to ask and nothing missing to report.
 */
export async function syncAssetDurations(
  client: Client,
  candidates: AssetDurationCandidate[],
  options?: { dryRun?: boolean; ensureValidToken?: EnsureValidToken },
): Promise<AssetDurationSyncResult> {
  const logger = await getLogger();
  const ctx = { name: 'asset-duration-sync' };
  const dryRun = options?.dryRun ?? false;

  const askable = candidates.filter(
    (candidate) =>
      isAssetDurationPlatform(candidate.platform) &&
      candidate.platform_content_id,
  );

  const result: AssetDurationSyncResult = {
    candidates: askable.length,
    written: 0,
    gaps: {},
    writtenIds: [],
    dryRun,
  };

  const recordGap = (reason: AssetDurationGap, count: number) => {
    result.gaps[reason] = (result.gaps[reason] ?? 0) + count;
  };

  if (askable.length === 0) return result;

  const byConnection = new Map<string, AssetDurationCandidate[]>();

  for (const candidate of askable) {
    if (!candidate.platform_connection_id) {
      recordGap('no_connection', 1);
      continue;
    }

    const key = `${candidate.platform}:${candidate.platform_connection_id}`;
    const group = byConnection.get(key) ?? [];

    group.push(candidate);
    byConnection.set(key, group);
  }

  if (dryRun) return result;

  const ensureValidToken =
    options?.ensureValidToken ?? (await loadEnsureValidToken());

  for (const group of byConnection.values()) {
    const { platform, platform_connection_id: connectionId } = group[0]!;

    try {
      const token = await ensureValidToken(connectionId!);

      if (!token.valid || !token.accessToken) {
        recordGap('token_invalid', group.length);
        continue;
      }

      const durations = await FETCHERS[platform as AssetDurationPlatform](
        token.accessToken,
        group.map((candidate) => candidate.platform_content_id!),
      );

      for (const candidate of group) {
        const seconds = durations.get(candidate.platform_content_id!);

        if (seconds === undefined) {
          recordGap('not_reported', 1);
          continue;
        }

        // `is null` again at write time: the read that chose this row and
        // this update are not one transaction, and the rule is fill-only.
        const { error } = await client
          .from('publishes')
          .update({ duration_seconds: seconds })
          .eq('id', candidate.id)
          .is('duration_seconds', null);

        if (error) {
          recordGap('write_failed', 1);
          logger.error(
            { ...ctx, publishId: candidate.id, error: error.message },
            'Failed to write an asset duration',
          );
          continue;
        }

        result.written++;
        result.writtenIds.push(candidate.id);
      }
    } catch (error) {
      const reason = classifyFailure(error);

      recordGap(reason, group.length);
      logger.warn(
        {
          ...ctx,
          platform,
          connectionId,
          reason,
          publishes: group.length,
          error: error instanceof Error ? error.message : String(error),
        },
        'Asset durations unavailable for a connection',
      );
    }
  }

  logger.info(
    { ...ctx, ...result, writtenIds: undefined },
    'Asset durations synced',
  );

  return result;
}

export interface AssetDurationBackfillResult extends AssetDurationSyncResult {
  /**
   * Candidates past this batch. Not "0 means finished": a publish whose
   * provider cannot report a duration stays a candidate for ever, so the
   * backfill is finished when `nextAfterId` is null.
   */
  remaining: number;
  /** Pass as `afterId` to continue; null when every candidate was examined. */
  nextAfterId: string | null;
}

const DEFAULT_BACKFILL_BATCH = 500;

/**
 * One-off backfill of every published YouTube and TikTok asset that predates
 * the column (FILM-1710 §2).
 *
 * The hourly sync only fills publishes it still visits, and it stops
 * visiting old ones and ones flagged for re-auth. Without this, historical
 * rows keep a null duration for ever — correct, but not a corrected figure.
 *
 * The candidate list is read in full *before* any write. Paging by range
 * over `duration_seconds is null` while filling that column shrinks the set
 * under the cursor, and range pagination over a shrinking set skips rows.
 *
 * Resumed by id cursor, not by re-reading from the start: unresolvable
 * publishes stay candidates, so a capped batch that always began at the
 * first id would re-ask about the same ones and never reach the rest.
 *
 * Finishes by re-upserting the touched rows into ClickHouse `video_dim`.
 */
export async function runAssetDurationBackfillBatch(options?: {
  maxPublishes?: number;
  afterId?: string;
  dryRun?: boolean;
}): Promise<AssetDurationBackfillResult> {
  const client: Client = getSupabaseServerAdminClient();
  const maxPublishes = options?.maxPublishes ?? DEFAULT_BACKFILL_BATCH;

  const candidates = await fetchAllRows<AssetDurationCandidate>((from, to) => {
    const query = client
      .from('publishes')
      .select('id, platform, platform_connection_id, platform_content_id')
      .eq('status', 'published')
      .not('platform_content_id', 'is', null)
      .is('duration_seconds', null)
      .in('platform', [...ASSET_DURATION_PLATFORMS]);

    return (options?.afterId ? query.gt('id', options.afterId) : query)
      .order('id')
      .range(from, to);
  }, 'publishes (asset duration backfill)');

  const batch = candidates.slice(0, maxPublishes);
  const remaining = candidates.length - batch.length;

  const result = await syncAssetDurations(client, batch, {
    dryRun: options?.dryRun,
  });

  if (result.writtenIds.length > 0) {
    const { upsertVideoDims } = await import('./dim-sync');

    await upsertVideoDims(result.writtenIds);
  }

  return {
    ...result,
    remaining,
    nextAfterId: remaining > 0 ? batch[batch.length - 1]!.id : null,
  };
}
