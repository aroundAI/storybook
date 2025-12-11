import 'server-only';

/**
 * Supported platforms for analytics sync
 */
export type SyncPlatform = 'youtube' | 'tiktok' | 'instagram';

/**
 * Publish record with sync-relevant fields
 */
export interface PublishForSync {
  id: string;
  episode_id: string;
  platform: SyncPlatform;
  platform_connection_id: string;
  platform_content_id: string;
  published_at: string;
  metadata: PublishMetadata | null;
}

/**
 * Sync tracking metadata stored in publishes.metadata.sync
 */
export interface SyncMetadata {
  last_synced_at?: string;
  last_sync_status?: 'success' | 'failed' | 'scope_error' | 'rate_limited';
  last_error?: string;
  consecutive_failures?: number;
  requires_reauth?: boolean;
}

/**
 * Extended metadata structure for publishes
 */
export interface PublishMetadata {
  [key: string]: unknown;
  sync?: SyncMetadata;
}

/**
 * Result from syncing a single publish
 */
export interface SyncResult {
  publishId: string;
  success: boolean;
  error?: string;
  errorType?: 'auth' | 'rate_limit' | 'scope' | 'not_found' | 'unknown';
  metricsUpdated?: boolean;
}

/**
 * Result from the entire sync job
 */
export interface SyncJobResult {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  byPlatform: Record<
    SyncPlatform,
    {
      processed: number;
      successful: number;
      failed: number;
    }
  >;
  durationMs: number;
}

/**
 * Normalized analytics data for database insertion
 */
export interface NormalizedAnalytics {
  publish_id: string;
  snapshot_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watch_time_seconds: number;
  subscribers_gained: number;
  revenue_cents: number;
  retention_data: object | null;
  raw_data: object;
}

/**
 * Rate limit configuration per platform
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
}

/**
 * Sync schedule configuration
 */
export interface SyncSchedule {
  frequency: 'hourly' | 'every_6_hours' | 'daily' | 'weekly';
  nextSyncAt: Date;
  ageCategory: 'first_day' | 'first_week' | 'first_month' | 'after_90_days';
}

/**
 * Sync status response for getSyncStatusAction
 */
export interface SyncStatusResponse {
  publishId: string;
  platform: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  requiresReauth: boolean;
}
