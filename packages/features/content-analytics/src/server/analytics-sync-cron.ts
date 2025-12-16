import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  InstagramInsightsScopeError,
  createInstagramInsightsProvider,
} from '../providers/instagram';
import type { InstagramInsightsResult } from '../providers/instagram';
import {
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
  createTikTokAnalyticsProvider,
} from '../providers/tiktok';
import type { TikTokAnalyticsResult } from '../providers/tiktok';
import {
  YouTubeAnalyticsScopeError,
  createYouTubeAnalyticsProvider,
} from '../providers/youtube';
import type { YouTubeAnalyticsResult } from '../providers/youtube';
import { getRateLimiter } from './rate-limiter';
import { getSyncPriority, shouldSyncNow } from './schedule';
import type {
  NormalizedAnalytics,
  PublishForSync,
  PublishMetadata,
  SyncJobResult,
  SyncPlatform,
  SyncResult,
} from './types';

const BATCH_SIZE = 50;
const MAX_CONSECUTIVE_FAILURES = 5;

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * Token validation result from ensureValidToken
 */
interface TokenValidationResult {
  valid: boolean;
  accessToken?: string;
  error?: string;
  requiresReauth?: boolean;
}

/**
 * Dynamically imports ensureValidToken from publishing package
 * to avoid circular dependencies
 */
async function getEnsureValidToken(): Promise<
  (connectionId: string) => Promise<TokenValidationResult>
> {
  const { ensureValidToken } = await import('@kit/publishing/token-refresh');
  return ensureValidToken;
}

/**
 * Main analytics sync job function.
 * Called by the cron endpoint to process batch of publishes.
 */
export async function runAnalyticsSyncJob(): Promise<SyncJobResult> {
  const logger = await getLogger();
  const ctx = { name: 'analytics-sync-cron' };
  const startTime = Date.now();

  const client = getSupabaseServerClient();
  const rateLimiter = getRateLimiter();

  const result: SyncJobResult = {
    success: true,
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    byPlatform: {
      youtube: { processed: 0, successful: 0, failed: 0 },
      tiktok: { processed: 0, successful: 0, failed: 0 },
      instagram: { processed: 0, successful: 0, failed: 0 },
    },
    durationMs: 0,
  };

  try {
    // 1. Fetch publishes that need syncing
    const publishesToSync = await fetchPublishesForSync(client, BATCH_SIZE);

    if (publishesToSync.length === 0) {
      logger.info(ctx, 'No publishes to sync');
      result.durationMs = Date.now() - startTime;
      return result;
    }

    logger.info(
      { ...ctx, count: publishesToSync.length },
      `Found ${publishesToSync.length} publishes to sync`,
    );

    // 2. Group by platform for efficient processing
    const byPlatform = groupByPlatform(publishesToSync);

    // 3. Process each platform with rate limiting
    const syncPromises: Promise<SyncResult>[] = [];

    for (const [platform, publishes] of Object.entries(byPlatform)) {
      for (const publish of publishes) {
        // Check rate limits before queuing
        if (!rateLimiter.canRequest(platform as SyncPlatform)) {
          logger.warn(
            { ...ctx, platform, publishId: publish.id },
            'Rate limited - skipping',
          );
          result.skipped++;
          continue;
        }

        syncPromises.push(
          syncSinglePublish(publish, platform as SyncPlatform, ctx),
        );
      }
    }

    // 4. Process all syncs with Promise.allSettled
    const syncResults = await Promise.allSettled(syncPromises);

    // 5. Process results
    for (const settledResult of syncResults) {
      result.totalProcessed++;

      if (settledResult.status === 'fulfilled') {
        const syncResult = settledResult.value;
        const platform = getPlatformFromPublishId(
          syncResult.publishId,
          publishesToSync,
        );

        if (syncResult.success) {
          result.successful++;
          if (platform) {
            result.byPlatform[platform].successful++;
            result.byPlatform[platform].processed++;
          }
        } else {
          result.failed++;
          if (platform) {
            result.byPlatform[platform].failed++;
            result.byPlatform[platform].processed++;
          }
        }
      } else {
        result.failed++;
        logger.error(
          { ...ctx, error: settledResult.reason },
          'Sync promise rejected',
        );
      }
    }

    result.durationMs = Date.now() - startTime;
    logger.info({ ...ctx, ...result }, 'Sync job completed');

    return result;
  } catch (error) {
    result.success = false;
    result.durationMs = Date.now() - startTime;

    logger.error(
      {
        ...ctx,
        error: error instanceof Error ? error.message : String(error),
      },
      'Sync job failed',
    );

    return result;
  }
}

/**
 * Fetches publishes that are due for syncing
 */
async function fetchPublishesForSync(
  client: Client,
  limit: number,
): Promise<PublishForSync[]> {
  // Query publishes that:
  // 1. Have status = 'published'
  // 2. Have a platform_content_id (means they were actually published)
  // 3. Platform is youtube, tiktok, or instagram
  // 4. Sorted by published_at descending (newer content first)
  const { data, error } = await client
    .from('publishes')
    .select(
      `
      id,
      episode_id,
      platform,
      platform_connection_id,
      platform_content_id,
      published_at,
      metadata
    `,
    )
    .eq('status', 'published')
    .not('platform_content_id', 'is', null)
    .in('platform', ['youtube', 'tiktok', 'instagram'])
    .order('published_at', { ascending: false })
    .limit(limit * 2); // Fetch extra to account for filtering

  if (error || !data) {
    return [];
  }

  // Filter based on sync schedule and metadata
  const eligiblePublishes: PublishForSync[] = [];

  for (const row of data) {
    if (eligiblePublishes.length >= limit) break;

    const metadata = row.metadata as PublishMetadata | null;
    const syncMeta = metadata?.sync;

    // Skip if too many consecutive failures
    if (
      syncMeta?.consecutive_failures &&
      syncMeta.consecutive_failures >= MAX_CONSECUTIVE_FAILURES
    ) {
      continue;
    }

    // Skip if requires reauth
    if (syncMeta?.requires_reauth) {
      continue;
    }

    // Check if should sync based on schedule
    const publishedAt = new Date(row.published_at!);
    const lastSyncedAt = syncMeta?.last_synced_at
      ? new Date(syncMeta.last_synced_at)
      : null;

    if (!shouldSyncNow(publishedAt, lastSyncedAt)) {
      continue;
    }

    eligiblePublishes.push({
      id: row.id,
      episode_id: row.episode_id,
      platform: row.platform as SyncPlatform,
      platform_connection_id: row.platform_connection_id,
      platform_content_id: row.platform_content_id!,
      published_at: row.published_at!,
      metadata,
    });
  }

  // Sort by priority (newer content first)
  return eligiblePublishes.sort((a, b) => {
    const priorityA = getSyncPriority(new Date(a.published_at));
    const priorityB = getSyncPriority(new Date(b.published_at));
    return priorityA - priorityB;
  });
}

/**
 * Groups publishes by platform
 */
function groupByPlatform(
  publishes: PublishForSync[],
): Record<SyncPlatform, PublishForSync[]> {
  const groups: Record<SyncPlatform, PublishForSync[]> = {
    youtube: [],
    tiktok: [],
    instagram: [],
  };

  for (const publish of publishes) {
    groups[publish.platform].push(publish);
  }

  return groups;
}

/**
 * Syncs analytics for a single publish
 */
async function syncSinglePublish(
  publish: PublishForSync,
  platform: SyncPlatform,
  ctx: { name: string },
): Promise<SyncResult> {
  const logger = await getLogger();
  const client = getSupabaseServerClient();
  const rateLimiter = getRateLimiter();

  try {
    // 1. Validate and refresh token
    const ensureValidToken = await getEnsureValidToken();
    const tokenResult = await ensureValidToken(publish.platform_connection_id);

    if (!tokenResult.valid) {
      const isAuthError =
        tokenResult.error === 'REFRESH_FAILED' ||
        tokenResult.error === 'NO_REFRESH_TOKEN';

      await updatePublishSyncMetadata(client, publish.id, {
        last_sync_status: isAuthError ? 'scope_error' : 'failed',
        last_error: tokenResult.error ?? 'Token validation failed',
        requires_reauth: tokenResult.requiresReauth ?? false,
      });

      return {
        publishId: publish.id,
        success: false,
        error: tokenResult.error ?? 'Token validation failed',
        errorType: isAuthError ? 'auth' : 'unknown',
      };
    }

    // 2. Record rate limit usage
    rateLimiter.recordRequest(platform);

    // 3. Fetch analytics from platform
    const analytics = await fetchPlatformAnalytics(
      platform,
      publish.platform_content_id,
      tokenResult.accessToken!,
      publish.platform_connection_id,
      client,
    );

    // 4. Normalize and insert into content_analytics
    const snapshotDate = new Date().toISOString().split('T')[0]!;

    const normalizedData: NormalizedAnalytics = normalizeAnalytics(
      publish.id,
      snapshotDate,
      platform,
      analytics,
    );

    // 5. Upsert analytics (update if same day, insert if new)
    await upsertContentAnalytics(client, normalizedData);

    // 5b. If there's revenue, also upsert to revenue_records table
    if (normalizedData.revenue_cents > 0) {
      await upsertRevenueRecord(client, {
        publish_id: normalizedData.publish_id,
        platform,
        record_date: normalizedData.snapshot_date,
        revenue_cents: normalizedData.revenue_cents,
        source: 'api',
      });
    }

    // 6. Update publish metadata
    await updatePublishSyncMetadata(client, publish.id, {
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_error: undefined,
      consecutive_failures: 0,
      requires_reauth: false,
    });

    logger.info(
      { ...ctx, publishId: publish.id, platform },
      'Analytics synced successfully',
    );

    return {
      publishId: publish.id,
      success: true,
      metricsUpdated: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorType: SyncResult['errorType'] = 'unknown';
    let syncStatus: NonNullable<PublishMetadata['sync']>['last_sync_status'] =
      'failed';

    // Handle specific error types
    if (
      error instanceof YouTubeAnalyticsScopeError ||
      error instanceof TikTokAnalyticsScopeError ||
      error instanceof InstagramInsightsScopeError
    ) {
      errorType = 'scope';
      syncStatus = 'scope_error';
    } else if (error instanceof TikTokRateLimitError) {
      errorType = 'rate_limit';
      syncStatus = 'rate_limited';
    }

    // Update metadata with failure info
    const currentMetadata = publish.metadata as PublishMetadata | null;
    const currentFailures = currentMetadata?.sync?.consecutive_failures ?? 0;

    await updatePublishSyncMetadata(client, publish.id, {
      last_sync_status: syncStatus,
      last_error: errorMessage,
      consecutive_failures: currentFailures + 1,
      requires_reauth: errorType === 'scope',
    });

    logger.error(
      { ...ctx, publishId: publish.id, platform, error: errorMessage },
      'Analytics sync failed',
    );

    return {
      publishId: publish.id,
      success: false,
      error: errorMessage,
      errorType,
    };
  }
}

/**
 * Fetches analytics from the appropriate platform provider
 */
async function fetchPlatformAnalytics(
  platform: SyncPlatform,
  contentId: string,
  accessToken: string,
  connectionId: string,
  client: Client,
): Promise<
  YouTubeAnalyticsResult | TikTokAnalyticsResult | InstagramInsightsResult
> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // Last 24 hours for daily snapshot

  switch (platform) {
    case 'youtube': {
      const provider = createYouTubeAnalyticsProvider(accessToken);
      return provider.getVideoAnalytics({
        videoId: contentId,
        startDate,
        endDate,
      });
    }
    case 'tiktok': {
      const provider = createTikTokAnalyticsProvider(accessToken);
      return provider.getVideoAnalytics({
        videoId: contentId,
        dateRange: 7,
      });
    }
    case 'instagram': {
      // Instagram needs the account ID from the connection
      const { data: connection } = await client
        .from('platform_connections')
        .select('platform_account_id')
        .eq('id', connectionId)
        .single();

      const provider = createInstagramInsightsProvider(
        accessToken,
        connection?.platform_account_id ?? '',
      );
      return provider.getMediaInsights({ mediaId: contentId });
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Normalizes platform-specific analytics to database schema
 */
function normalizeAnalytics(
  publishId: string,
  snapshotDate: string,
  platform: SyncPlatform,
  rawData: unknown,
): NormalizedAnalytics {
  switch (platform) {
    case 'youtube': {
      const data = rawData as YouTubeAnalyticsResult;
      return {
        publish_id: publishId,
        snapshot_date: snapshotDate,
        views: data.totals.views,
        likes: data.totals.likes,
        comments: data.totals.comments,
        shares: data.totals.shares,
        watch_time_seconds: (data.totals.estimatedMinutesWatched ?? 0) * 60,
        subscribers_gained: data.totals.subscribersGained ?? 0,
        revenue_cents: Math.round((data.totals.estimatedRevenue ?? 0) * 100),
        retention_data:
          (data.retention as unknown as Record<string, unknown>) ?? null,
        raw_data: data as unknown as Record<string, unknown>,
      };
    }
    case 'tiktok': {
      const data = rawData as TikTokAnalyticsResult;
      return {
        publish_id: publishId,
        snapshot_date: snapshotDate,
        views: data.totals.views,
        likes: data.totals.likes,
        comments: data.totals.comments,
        shares: data.totals.shares,
        watch_time_seconds: data.totals.totalPlayTime ?? 0,
        subscribers_gained: 0, // TikTok doesn't provide per-video follower gains
        revenue_cents: 0, // TikTok doesn't expose revenue
        retention_data: null,
        raw_data: data as unknown as Record<string, unknown>,
      };
    }
    case 'instagram': {
      const data = rawData as InstagramInsightsResult;
      return {
        publish_id: publishId,
        snapshot_date: snapshotDate,
        views: data.totals.plays ?? data.totals.impressions ?? 0,
        likes: data.totals.likes ?? 0,
        comments: data.totals.comments ?? 0,
        shares: data.totals.shares ?? 0,
        watch_time_seconds: 0, // Instagram doesn't expose this
        subscribers_gained: data.totals.follows ?? 0,
        revenue_cents: 0,
        retention_data: null,
        raw_data: data as unknown as Record<string, unknown>,
      };
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Upserts content analytics (insert or update if same day)
 */
async function upsertContentAnalytics(
  client: Client,
  data: NormalizedAnalytics,
): Promise<void> {
  const { error } = await client.from('content_analytics').upsert(data, {
    onConflict: 'publish_id,snapshot_date',
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`Failed to upsert analytics: ${error.message}`);
  }
}

/**
 * Updates the sync metadata on a publish record
 */
async function updatePublishSyncMetadata(
  client: Client,
  publishId: string,
  syncData: Partial<NonNullable<PublishMetadata['sync']>>,
): Promise<void> {
  // First get existing metadata
  const { data: existing, error: selectError } = await client
    .from('publishes')
    .select('metadata')
    .eq('id', publishId)
    .single();

  if (selectError) {
    throw new Error(`Failed to fetch publish metadata: ${selectError.message}`);
  }

  const currentMetadata = (existing?.metadata ?? {}) as PublishMetadata;

  // Merge sync data
  const updatedMetadata: PublishMetadata = {
    ...currentMetadata,
    sync: {
      ...currentMetadata.sync,
      ...syncData,
    },
  };

  const { error: updateError } = await client
    .from('publishes')
    .update({ metadata: updatedMetadata })
    .eq('id', publishId);

  if (updateError) {
    throw new Error(
      `Failed to update publish metadata: ${updateError.message}`,
    );
  }
}

/**
 * Helper to get platform from publish ID
 */
function getPlatformFromPublishId(
  publishId: string,
  publishes: PublishForSync[],
): SyncPlatform | null {
  const publish = publishes.find((p) => p.id === publishId);
  return publish?.platform ?? null;
}

/**
 * Syncs analytics for a specific publish (manual trigger)
 */
export async function syncSinglePublishById(
  publishId: string,
): Promise<SyncResult> {
  const ctx = { name: 'analytics-sync-manual' };
  const client = getSupabaseServerClient();

  // Fetch the publish
  const { data: publish, error } = await client
    .from('publishes')
    .select(
      `
      id,
      episode_id,
      platform,
      platform_connection_id,
      platform_content_id,
      published_at,
      metadata
    `,
    )
    .eq('id', publishId)
    .single();

  if (error || !publish) {
    return {
      publishId,
      success: false,
      error: 'Publish not found',
      errorType: 'not_found',
    };
  }

  if (!publish.platform_content_id) {
    return {
      publishId,
      success: false,
      error: 'Publish has no platform content ID',
      errorType: 'not_found',
    };
  }

  const platform = publish.platform as SyncPlatform;
  if (!['youtube', 'tiktok', 'instagram'].includes(platform)) {
    return {
      publishId,
      success: false,
      error: `Unsupported platform: ${platform}`,
      errorType: 'unknown',
    };
  }

  return syncSinglePublish(
    {
      id: publish.id,
      episode_id: publish.episode_id,
      platform,
      platform_connection_id: publish.platform_connection_id,
      platform_content_id: publish.platform_content_id,
      published_at: publish.published_at!,
      metadata: publish.metadata as PublishMetadata | null,
    },
    platform,
    ctx,
  );
}

/**
 * Revenue record data for upsert
 */
interface RevenueRecordData {
  publish_id: string;
  platform: string;
  record_date: string;
  revenue_cents: number;
  source: 'api' | 'manual';
  breakdown?: Record<string, unknown>;
}

/**
 * Upserts revenue record (insert or update if same day)
 * FILM-810: Store revenue data separately for detailed analytics
 */
async function upsertRevenueRecord(
  client: Client,
  data: RevenueRecordData,
): Promise<void> {
  const { error } = await client.from('revenue_records').upsert(
    {
      publish_id: data.publish_id,
      platform: data.platform,
      record_date: data.record_date,
      revenue_cents: data.revenue_cents,
      currency: 'USD',
      source: data.source,
      breakdown: data.breakdown ?? {},
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'publish_id,record_date',
      ignoreDuplicates: false,
    },
  );

  if (error) {
    // Log but don't fail the sync - revenue_records is supplementary
    const logger = await getLogger();
    logger.warn(
      { error: error.message, publishId: data.publish_id },
      'Failed to upsert revenue record',
    );
  }
}
