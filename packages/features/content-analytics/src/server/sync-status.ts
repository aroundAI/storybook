import 'server-only';

import {
  MAX_CONSECUTIVE_FAILURES,
  type SyncStatusResponse,
  toAttemptStatus,
} from '../lib/sync-status';
import { FacebookInsightsScopeError } from '../providers/facebook';
import { InstagramInsightsScopeError } from '../providers/instagram';
import {
  TikTokAnalyticsScopeError,
  TikTokRateLimitError,
} from '../providers/tiktok';
import { YouTubeAnalyticsScopeError } from '../providers/youtube';
import { syncEligibility, toConnectionGrant } from './sync-authorisation';
import type { PublishMetadata, SyncMetadata, SyncResult } from './types';

/**
 * KB-150. The one reading of `publishes.metadata.sync` — what
 * `getSyncStatusAction` returns — and the one classification of a failed
 * attempt the sync writes into it.
 */

/** A publish row as `getSyncStatusAction` reads it. */
export interface SyncStatusRow {
  id: string;
  platform: string;
  metadata: unknown;
  platform_connections: {
    scopes: string[] | null;
    metadata: unknown;
    disconnected_at: string | null;
  } | null;
}

export function toSyncStatus(row: SyncStatusRow): SyncStatusResponse {
  const sync = (row.metadata as PublishMetadata | null)?.sync;

  return {
    publishId: row.id,
    platform: row.platform,
    lastSyncedAt: sync?.last_synced_at ?? null,
    lastSyncStatus: toAttemptStatus(sync?.last_sync_status),
    lastError: sync?.last_error ?? null,
    lastFailedAt: sync?.last_failed_at ?? null,
    consecutiveFailures: sync?.consecutive_failures ?? 0,
    requiresReauth: sync?.requires_reauth ?? false,
    schedule: syncEligibility({
      platform: row.platform,
      sync,
      grant: row.platform_connections
        ? toConnectionGrant(row.platform_connections)
        : undefined,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    }),
  };
}

/**
 * What a thrown sync failure is recorded as. `reason` is the platform's own
 * words where the provider kept them, so the creator reads what the vendor
 * said rather than this app's paraphrase of it.
 */
export function classifySyncFailure(error: unknown): {
  status: NonNullable<SyncMetadata['last_sync_status']>;
  errorType: NonNullable<SyncResult['errorType']>;
  message: string;
  reason: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const reason = platformReasonOf(error) ?? message;

  if (
    error instanceof YouTubeAnalyticsScopeError ||
    error instanceof TikTokAnalyticsScopeError ||
    error instanceof InstagramInsightsScopeError ||
    error instanceof FacebookInsightsScopeError
  ) {
    return { status: 'scope_error', errorType: 'scope', message, reason };
  }

  if (error instanceof TikTokRateLimitError) {
    return { status: 'rate_limited', errorType: 'rate_limit', message, reason };
  }

  return { status: 'failed', errorType: 'unknown', message, reason };
}

function platformReasonOf(error: unknown): string | null {
  if (
    (error instanceof TikTokAnalyticsScopeError ||
      error instanceof TikTokRateLimitError) &&
    error.platformReason
  ) {
    return error.platformReason;
  }

  return null;
}
