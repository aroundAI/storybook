import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  formatDateStr,
  insertRetentionCurves,
  insertVideoAudience,
  insertVideoMetrics,
  insertVideoSnapshots,
  queryLatestSnapshots,
} from '@kit/clickhouse/server';
import type {
  SnapshotTotals,
  VideoMetric,
  VideoSnapshot,
} from '@kit/clickhouse/server';
import { getLogger } from '@kit/shared/logger';
import { fetchAllByIds } from '@kit/shared/pagination';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { planRevenueRowWrites } from '../lib/revenue-mix';
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
import {
  buildAudienceRows,
  buildRetentionPoints,
  buildYouTubeDailyRows,
  computeSnapshotDelta,
  computeYouTubeWindow,
  latestDataDate,
  shouldWriteMetricRow,
  snapshotDeltaMetricDate,
} from './ingest';
import { getRateLimiter } from './rate-limiter';
import { getSyncPriority, shouldSyncNow } from './schedule';
import {
  mayFetchRevenue,
  syncEligibility,
  toConnectionGrant,
} from './sync-authorisation';
import type { ConnectionGrant } from './sync-authorisation';
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
const REVENUE_REQUIREMENT = 'youtube.revenue';

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

  const client = getSupabaseServerAdminClient();
  const rateLimiter = getRateLimiter();

  const result: SyncJobResult = {
    success: true,
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    notAuthorised: 0,
    byPlatform: {
      youtube: { processed: 0, successful: 0, failed: 0 },
      tiktok: { processed: 0, successful: 0, failed: 0 },
      instagram: { processed: 0, successful: 0, failed: 0 },
    },
    durationMs: 0,
  };

  try {
    // 1. Fetch publishes that need syncing
    const { publishes: publishesToSync, notAuthorised } =
      await fetchPublishesForSync(client, BATCH_SIZE);

    result.notAuthorised = notAuthorised;

    if (notAuthorised > 0) {
      // Once per run, not once per publish: these are a permanent condition
      // until a creator reconnects, and a line each is how a log stops being
      // read.
      logger.info(
        { ...ctx, notAuthorised },
        'Left alone: connection lacks the analytics scope',
      );
    }

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

    // Keep the dimension table fresh: batch upsert for this run's
    // publishes, full reconcile once a day (publishes has no updated_at)
    const { upsertVideoDims } = await import('./dim-sync');
    await upsertVideoDims(
      new Date().getUTCHours() === 2
        ? undefined
        : publishesToSync.map((p) => p.id),
    );

    // Prefetch delta baselines for cumulative-counter platforms in one query
    const snapshotBaselines = await fetchSnapshotBaselines(publishesToSync);

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
          syncSinglePublish(
            publish,
            platform as SyncPlatform,
            ctx,
            snapshotBaselines,
          ),
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

    // 6. Evaluate revenue alert rules for the accounts touched this run
    await evaluateRevenueAlertsForBatch(client, publishesToSync);

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
export async function fetchPublishesForSync(
  client: Client,
  limit: number,
): Promise<{ publishes: PublishForSync[]; notAuthorised: number }> {
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
    return { publishes: [], notAuthorised: 0 };
  }

  const grants = await fetchConnectionGrants(
    client,
    data.map((row) => row.platform_connection_id),
  );

  // Filter based on sync schedule and metadata
  const eligiblePublishes: PublishForSync[] = [];
  let notAuthorised = 0;

  for (const row of data) {
    if (eligiblePublishes.length >= limit) break;

    const metadata = row.metadata as PublishMetadata | null;
    const syncMeta = metadata?.sync;
    const grant = grants.get(row.platform_connection_id);

    const eligibility = syncEligibility({
      platform: row.platform,
      sync: syncMeta,
      grant,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    });

    if (eligibility === 'not_authorised') {
      notAuthorised++;
      continue;
    }

    if (eligibility === 'suppressed') {
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
      connection: grant,
    });
  }

  // Sort by priority (newer content first)
  eligiblePublishes.sort((a, b) => {
    const priorityA = getSyncPriority(new Date(a.published_at));
    const priorityB = getSyncPriority(new Date(b.published_at));
    return priorityA - priorityB;
  });

  return { publishes: eligiblePublishes, notAuthorised };
}

/**
 * What each connection's OAuth callback recorded, keyed by connection id.
 */
async function fetchConnectionGrants(
  client: Client,
  connectionIds: Array<string | null>,
): Promise<Map<string, ConnectionGrant>> {
  const ids = [
    ...new Set(connectionIds.filter((id): id is string => id !== null)),
  ];

  const rows = await fetchAllByIds<{
    id: string;
    scopes: string[] | null;
    metadata: unknown;
  }>(
    ids,
    (chunk, from, to) =>
      client
        .from('platform_connections')
        .select('id, scopes, metadata')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'connection grants',
  );

  return new Map(rows.map((row) => [row.id, toConnectionGrant(row)]));
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
  snapshotBaselines?: Map<string, SnapshotTotals>,
): Promise<SyncResult> {
  const logger = await getLogger();
  const client = getSupabaseServerAdminClient();
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
        last_failed_at: new Date().toISOString(),
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
      publish,
      tokenResult.accessToken!,
      client,
    );

    // 4. Normalize analytics data (raw payload + revenue extraction)
    const snapshotDate = formatDateStr(new Date());

    const normalizedData: NormalizedAnalytics = normalizeAnalytics(
      publish.id,
      snapshotDate,
      platform,
      analytics,
    );

    // 5. Insert into ClickHouse (skip if projectId unresolvable — UUID column)
    const projectId = await resolveProjectId(client, publish.episode_id);
    let ingestedDataDate: string | undefined;

    if (!projectId) {
      logger.warn(
        { publishId: publish.id, episodeId: publish.episode_id },
        'Skipping ClickHouse ingestion: could not resolve project_id',
      );
    } else if (platform === 'youtube') {
      ingestedDataDate = await ingestYouTubeDaily(
        projectId,
        publish,
        analytics as YouTubeAnalyticsResult,
        normalizedData,
      );
    } else {
      await ingestCumulativeSnapshot(
        projectId,
        publish,
        platform,
        analytics as TikTokAnalyticsResult | InstagramInsightsResult,
        normalizedData,
        snapshotBaselines?.get(publish.id) ?? null,
        snapshotBaselines !== undefined,
      );
    }

    // 5b. Revenue lands in Postgres split by category so the revenue mix
    // (ads vs Premium vs sponsorship) is measurable. Only when it was
    // measured: an unauthorised zero would otherwise correct today's real
    // figure down to nothing.
    if (normalizedData.revenue_measured) {
      await upsertRevenueRecords(client, platform, normalizedData);
    }

    if (platform === 'youtube') {
      await recordRevenueGate(
        client,
        publish,
        (analytics as YouTubeAnalyticsResult).revenueAccess,
      );
    }

    // 6. Update publish metadata
    await updatePublishSyncMetadata(client, publish.id, {
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_error: undefined,
      consecutive_failures: 0,
      requires_reauth: false,
      ...(ingestedDataDate ? { last_data_date: ingestedDataDate } : {}),
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
      last_failed_at: new Date().toISOString(),
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
 * Fetches analytics from the appropriate platform provider.
 *
 * YouTube is fetched over [last ingested data date − 3d, now] so recent
 * restatements are absorbed; the per-day breakdown is what gets stored.
 * TikTok and Instagram return lifetime cumulative counters regardless of
 * any date parameters — those are turned into daily deltas at ingest time.
 */
async function fetchPlatformAnalytics(
  platform: SyncPlatform,
  publish: PublishForSync,
  accessToken: string,
  client: Client,
): Promise<
  YouTubeAnalyticsResult | TikTokAnalyticsResult | InstagramInsightsResult
> {
  switch (platform) {
    case 'youtube': {
      const { startDate, endDate } = computeYouTubeWindow({
        lastDataDate: publish.metadata?.sync?.last_data_date,
        publishedAt: publish.published_at,
      });
      const provider = createYouTubeAnalyticsProvider(accessToken);
      return provider.getVideoAnalytics({
        videoId: publish.platform_content_id,
        startDate,
        endDate,
        includeRevenue: mayFetchRevenue(publish.connection),
      });
    }
    case 'tiktok': {
      const provider = createTikTokAnalyticsProvider(accessToken);
      return provider.getVideoAnalytics({
        videoId: publish.platform_content_id,
        dateRange: 7,
      });
    }
    case 'instagram': {
      // Instagram needs the account ID from the connection
      const { data: connection } = await client
        .from('platform_connections')
        .select('platform_account_id')
        .eq('id', publish.platform_connection_id)
        .single();

      const provider = createInstagramInsightsProvider(
        accessToken,
        connection?.platform_account_id ?? '',
      );
      return provider.getMediaInsights({
        mediaId: publish.platform_content_id,
      });
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Runs the revenue alert rules once per account represented in the batch.
 */
async function evaluateRevenueAlertsForBatch(
  client: Client,
  publishes: PublishForSync[],
): Promise<void> {
  if (publishes.length === 0) return;

  // Chunked: this derives the distinct set of accounts whose revenue alerts
  // get evaluated, so a dropped row means an account is silently skipped.
  const data = await fetchAllByIds<{ projects: unknown }>(
    publishes.map((p) => p.episode_id),
    (chunk, from, to) =>
      client
        .from('episodes')
        .select('projects!inner(account_id)')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'alert account ids',
  );

  const accountIds = new Set<string>();

  for (const row of data) {
    const project = row.projects as unknown as { account_id?: string } | null;
    if (project?.account_id) accountIds.add(project.account_id);
  }

  const { evaluateRevenueAlerts } = await import('./revenue-alerts');

  for (const accountId of accountIds) {
    await evaluateRevenueAlerts(client, accountId);
  }
}

/**
 * Prefetch the latest lifetime snapshots for all cumulative-counter
 * publishes (TikTok, Instagram) in the batch with a single ClickHouse query.
 */
async function fetchSnapshotBaselines(
  publishes: PublishForSync[],
): Promise<Map<string, SnapshotTotals>> {
  const cumulativeIds = publishes
    .filter((p) => p.platform !== 'youtube')
    .map((p) => p.id);

  if (cumulativeIds.length === 0) {
    return new Map();
  }

  return queryLatestSnapshots({
    videoIds: cumulativeIds,
    beforeDate: formatDateStr(new Date()),
  });
}

/**
 * Ingest YouTube per-day metrics as true daily rows keyed by the platform
 * data date. Returns the latest ingested data date (for the restatement
 * window on the next sync), or undefined when the API returned no rows.
 */
async function ingestYouTubeDaily(
  projectId: string,
  publish: PublishForSync,
  analytics: YouTubeAnalyticsResult,
  normalizedData: NormalizedAnalytics,
): Promise<string | undefined> {
  const rows = buildYouTubeDailyRows({
    projectId,
    videoId: publish.id,
    dailyData: analytics.dailyData,
    extraMetricsJson: JSON.stringify(normalizedData.raw_data ?? {}),
  });

  await insertVideoMetrics(rows);

  await insertRetentionCurves(
    buildRetentionPoints({ projectId, videoId: publish.id, analytics }),
  );
  await insertVideoAudience(
    buildAudienceRows({
      projectId,
      videoId: publish.id,
      platform: 'youtube',
      analytics,
    }),
  );

  return latestDataDate(analytics.dailyData) ?? undefined;
}

/**
 * Ingest a lifetime-cumulative platform sync (TikTok, Instagram):
 * today's row = current lifetime − latest prior snapshot, clamped ≥ 0.
 * The row is re-inserted on every sync and replaces itself as the day
 * accrues. Without a prior baseline, an adopted (>24h old) video only
 * records its baseline snapshot — a fresh video attributes its lifetime
 * to the publish date.
 */
async function ingestCumulativeSnapshot(
  projectId: string,
  publish: PublishForSync,
  platform: 'tiktok' | 'instagram',
  analytics: TikTokAnalyticsResult | InstagramInsightsResult,
  normalizedData: NormalizedAnalytics,
  prefetchedBaseline: SnapshotTotals | null,
  baselineWasPrefetched: boolean,
): Promise<void> {
  const baseline = baselineWasPrefetched
    ? prefetchedBaseline
    : ((
        await queryLatestSnapshots({
          videoIds: [publish.id],
          beforeDate: formatDateStr(new Date()),
        })
      ).get(publish.id) ?? null);

  const currentTotals = {
    views: normalizedData.views,
    likes: normalizedData.likes,
    comments: normalizedData.comments,
    shares: normalizedData.shares,
    saves: normalizedData.saves,
    watch_time_seconds: normalizedData.watch_time_seconds,
    subscribers_gained: normalizedData.subscribers_gained,
  };

  const writeContext = {
    hasBaseline: baseline !== null,
    publishedAt: publish.published_at,
  };

  if (shouldWriteMetricRow(writeContext)) {
    const delta = computeSnapshotDelta(currentTotals, baseline);

    const metric: VideoMetric = {
      project_id: projectId,
      video_id: publish.id,
      platform,
      metric_date: snapshotDeltaMetricDate(writeContext),
      ...delta,
      revenue_cents: 0,
      metric_source: 'snapshot_delta',
      extra_metrics: JSON.stringify(normalizedData.raw_data ?? {}),
    };

    await insertVideoMetrics([metric]);
  }

  const snapshot: VideoSnapshot = {
    project_id: projectId,
    video_id: publish.id,
    platform,
    snapshot_date: formatDateStr(new Date()),
    ...currentTotals,
  };

  await insertVideoSnapshots([snapshot]);

  await insertVideoAudience(
    buildAudienceRows({ projectId, videoId: publish.id, platform, analytics }),
  );
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
        saves: 0, // YouTube doesn't have saves
        watch_time_seconds: (data.totals.estimatedMinutesWatched ?? 0) * 60,
        subscribers_gained: data.totals.subscribersGained ?? 0,
        revenue_cents: data.totals.estimatedRevenue ?? 0,
        ad_revenue_cents: data.totals.estimatedAdRevenue ?? 0,
        red_revenue_cents: data.totals.estimatedRedPartnerRevenue ?? 0,
        revenue_measured: data.revenueAccess === 'authorised',
        subscribed_views: data.subscribedStatus?.subscribed ?? 0,
        unsubscribed_views: data.subscribedStatus?.notSubscribed ?? 0,
        device_breakdown: data.deviceBreakdown ?? null,
        os_breakdown: data.operatingSystem ?? null,
        city_breakdown: data.cityGeography ?? null,
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
        // Saves have no creator-auth surface on TikTok, and watch time is
        // Business API only. Both are structurally zero, not measured as zero.
        // docs/platform-capability-reference.md
        saves: 0,
        watch_time_seconds: 0,
        subscribers_gained: 0, // TikTok doesn't provide per-video follower gains
        revenue_cents: 0, // TikTok doesn't expose revenue
        ad_revenue_cents: 0,
        red_revenue_cents: 0,
        // True, as before: these platforms' zeros reconcile against any
        // 'api' row. See the cost note in upsertRevenueRecords.
        revenue_measured: true,
        subscribed_views: 0,
        unsubscribed_views: 0,
        device_breakdown: null, // TikTok API doesn't expose device breakdown
        os_breakdown: null,
        city_breakdown: null,
        retention_data: null,
        raw_data: data as unknown as Record<string, unknown>,
      };
    }
    case 'instagram': {
      const data = rawData as InstagramInsightsResult;
      return {
        publish_id: publishId,
        snapshot_date: snapshotDate,
        views: data.totals.views,
        likes: data.totals.likes ?? 0,
        comments: data.totals.comments ?? 0,
        shares: data.totals.shares ?? 0,
        saves: data.totals.saved ?? 0,
        watch_time_seconds: 0, // Instagram doesn't expose this
        subscribers_gained: data.totals.follows ?? 0,
        revenue_cents: 0,
        ad_revenue_cents: 0,
        red_revenue_cents: 0,
        // True, as before: these platforms' zeros reconcile against any
        // 'api' row. See the cost note in upsertRevenueRecords.
        revenue_measured: true,
        subscribed_views: 0,
        unsubscribed_views: 0,
        device_breakdown: null, // Instagram API doesn't expose device breakdown
        os_breakdown: null,
        city_breakdown: null,
        retention_data: null,
        raw_data: data as unknown as Record<string, unknown>,
      };
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Resolves project_id from episode_id via the episodes table.
 * Caches results in a module-level Map to avoid repeated lookups
 * within the same sync run.
 */
const projectIdCache = new Map<string, string>();

async function resolveProjectId(
  client: Client,
  episodeId: string,
): Promise<string | null> {
  if (projectIdCache.has(episodeId)) {
    return projectIdCache.get(episodeId)!;
  }

  const { data, error } = await client
    .from('episodes')
    .select('project_id')
    .eq('id', episodeId)
    .single();

  if (error || !data?.project_id) {
    return null;
  }

  projectIdCache.set(episodeId, data.project_id);
  return data.project_id;
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
  const client = getSupabaseServerAdminClient();

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

  if (!publish.platform_connection_id) {
    return {
      publishId,
      success: false,
      error: 'Publish has no platform connection',
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

  const grant = (
    await fetchConnectionGrants(client, [publish.platform_connection_id])
  ).get(publish.platform_connection_id);

  // `suppressed` is deliberately not refused here: a person asking for a sync
  // is allowed to retry what the schedule gave up on. A missing scope is
  // different — the call cannot succeed, so it is not made.
  if (
    syncEligibility({
      platform,
      sync: (publish.metadata as PublishMetadata | null)?.sync,
      grant,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    }) === 'not_authorised'
  ) {
    return {
      publishId,
      success: false,
      error:
        'This connection has not been granted analytics access. Reconnect it from Settings → Platforms.',
      errorType: 'not_authorised',
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
      connection: grant,
    },
    platform,
    ctx,
  );
}

/**
 * Records on the connection that YouTube refused revenue although the scope
 * is held (a channel outside the Partner Program), or clears it once revenue
 * arrives. Written only on a change. Publishes in a run share one grant
 * object, so a channel's fifty publishes cost a write or two (they sync
 * concurrently, and the first few can all see the old value), not fifty.
 */
async function recordRevenueGate(
  client: Client,
  publish: PublishForSync,
  access: YouTubeAnalyticsResult['revenueAccess'],
): Promise<void> {
  if (access !== 'authorised' && access !== 'account_type_gated') return;

  const gatedNow = access === 'account_type_gated';
  const gatedBefore =
    publish.connection?.accountGated.includes(REVENUE_REQUIREMENT) ?? false;

  if (gatedNow === gatedBefore) return;

  const { data: row, error } = await client
    .from('platform_connections')
    .select('metadata')
    .eq('id', publish.platform_connection_id)
    .single();

  if (error || !row) return;

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const others = toConnectionGrant({ metadata }).accountGated.filter(
    (id) => id !== REVENUE_REQUIREMENT,
  );
  const gated = gatedNow ? [...others, REVENUE_REQUIREMENT] : others;

  await client
    .from('platform_connections')
    .update({ metadata: { ...metadata, analytics_account_gated: gated } })
    .eq('id', publish.platform_connection_id);

  // The rest of this run reads the grant from memory, not the row.
  if (publish.connection) {
    publish.connection.accountGated = gated;
  }
}

/**
 * Writes the day's revenue split by category (FILM-1508).
 *
 * YouTube reports ad revenue and YouTube Premium revenue separately, and
 * the mix between them — plus manually-entered sponsorship and product
 * income — is the monetization health signal. Each category is its own
 * row; the unique index covers (publish/account, date, category, source), so
 * this writes the 'api' row and a person's entry for the same day and
 * category sits beside it rather than competing for the slot.
 *
 * Any revenue the platform reports but does not attribute to a category
 * falls into 'other' so totals still reconcile.
 */
async function upsertRevenueRecords(
  client: Client,
  platform: SyncPlatform,
  data: NormalizedAnalytics,
): Promise<void> {
  const uncategorized =
    data.revenue_cents - data.ad_revenue_cents - data.red_revenue_cents;

  // Not filtered to positive figures. A category the platform has revised
  // *down* to zero still needs its row corrected, and dropping it here left
  // the previous figure in place for good: no later sync visits that key, no
  // code path clears it, and `effectiveRevenueCategory` reads `source = 'api'`
  // as proof of a platform payout — so a stale 4000c of ads revenue inflates
  // `adsSharePercent` permanently. Owning a row includes zeroing it.
  const byCategory: Array<{ category: string; revenue_cents: number }> = [
    { category: 'ads', revenue_cents: data.ad_revenue_cents },
    { category: 'premium', revenue_cents: data.red_revenue_cents },
    { category: 'other', revenue_cents: Math.max(0, uncategorized) },
  ];

  const logger = await getLogger();

  // One read for the whole day rather than one per category.
  //
  // Honest about the cost, because it is not a straight win: on YouTube this
  // replaces up to three round-trips with one, but on TikTok and Instagram —
  // whose normalizers hardcode all three figures to zero — it replaces *none*
  // with one, on every publish of every run. That is the price of reconciling
  // against zero rather than filtering it out, and the price of not hardcoding
  // "these platforms never report revenue" here, which is an assumption that
  // silently rots the day one of them starts.
  //
  // Judged acceptable because the caller already makes a provider API call per
  // publish, next to which one indexed lookup on (publish_id, record_date) is
  // noise. If it ever stops being noise, the fix is a `revenue_supported` flag
  // on `NormalizedAnalytics` — set where the zeros are hardcoded, so adding
  // revenue to a platform cannot forget to update it.
  const { data: existingRows, error: existingError } = await client
    .from('revenue_records')
    .select('id, category, revenue_cents')
    .eq('publish_id', data.publish_id)
    .eq('record_date', data.snapshot_date)
    // The sync owns the 'api' rows for this key and nothing else. Since
    // `source` joined the unique index, a person's entry sits in its own
    // row — there is no collision to lose, and nothing to skip.
    .eq('source', 'api');

  // A failed lookup used to leave `existing` nullish and fall through to the
  // insert, which then collided with the unique index and was swallowed by
  // the warn below. The mirror of this lookup in revenue-actions.ts throws;
  // these two should not disagree about whether a failed read is survivable.
  if (existingError) {
    logger.warn(
      {
        name: 'analytics-sync',
        publishId: data.publish_id,
        date: data.snapshot_date,
        error: existingError,
      },
      'Skipping revenue rows: could not read the existing records',
    );

    return;
  }

  // The decision is pure and lives in `planRevenueRowWrites`, where the case
  // that matters — a figure revised down to zero — can be tested without a
  // database.
  const plan = planRevenueRowWrites(
    byCategory.map((row) => ({
      category: row.category,
      revenueCents: row.revenue_cents,
    })),
    (existingRows ?? []).map((row) => ({
      id: row.id,
      category: row.category,
      revenueCents: row.revenue_cents,
    })),
  );

  for (const write of plan) {
    const values = {
      publish_id: data.publish_id,
      platform,
      record_date: data.snapshot_date,
      revenue_cents: write.revenueCents,
      currency: 'USD',
      source: 'api' as const,
      category: write.category,
      updated_at: new Date().toISOString(),
    };

    const { error } =
      write.op === 'update'
        ? await client.from('revenue_records').update(values).eq('id', write.id)
        : await client.from('revenue_records').insert(values);

    if (error) {
      // Log but don't fail the sync - revenue_records is supplementary
      logger.warn(
        {
          error: error.message,
          publishId: data.publish_id,
          category: write.category,
        },
        'Failed to upsert revenue record',
      );
    }
  }
}
