import type { SyncEligibility } from '../server/sync-authorisation';
import { platformLabel } from './subscriber-total-note';

/**
 * KB-150. What a creator is told about a video's analytics sync: when its
 * figures were last refreshed and, when the latest attempt failed, why.
 *
 * Pure and client-safe, so the episode analytics page and the Video Log say
 * the same thing from the same `getSyncStatusAction` result.
 */

/** The platforms the analytics sync collects. Anything else is never synced. */
export const SYNCED_PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
] as const;

/**
 * After this many failures in a row the schedule stops trying a publish
 * until the creator reconnects (`syncEligibility`).
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

export type SyncAttemptStatus =
  | 'success'
  | 'failed'
  | 'scope_error'
  | 'rate_limited';

const ATTEMPT_STATUSES: readonly string[] = [
  'success',
  'failed',
  'scope_error',
  'rate_limited',
];

/** One publish's sync record, as `getSyncStatusAction` returns it. */
export interface SyncStatusResponse {
  publishId: string;
  platform: string;
  /** The last *successful* sync. Null when there has never been one. */
  lastSyncedAt: string | null;
  /** The latest attempt's outcome. Null when nothing was ever attempted. */
  lastSyncStatus: SyncAttemptStatus | null;
  /** What the platform gave as the reason, when the latest attempt failed. */
  lastError: string | null;
  /** When the latest failure was recorded. */
  lastFailedAt: string | null;
  consecutiveFailures: number;
  requiresReauth: boolean;
  /** Whether the schedule will try this publish again, as the sync decides. */
  schedule: SyncEligibility;
}

/** A stored status the sync never writes is not known, not a failure. */
export function toAttemptStatus(value: unknown): SyncAttemptStatus | null {
  return typeof value === 'string' && ATTEMPT_STATUSES.includes(value)
    ? (value as SyncAttemptStatus)
    : null;
}

export type SyncState =
  /** Collected, and the latest attempt succeeded. */
  | 'synced'
  /** Never attempted yet. */
  | 'not_synced_yet'
  /** The latest attempt failed. */
  | 'failed'
  /** The connection lacks the analytics scope, so no attempt is made. */
  | 'not_authorised'
  /** The channel was disconnected, so no attempt is made. */
  | 'disconnected';

export interface SyncStatusView {
  publishId: string;
  platform: string;
  state: SyncState;
  /** Null when the figures were never refreshed — never a made-up time. */
  lastSyncedAt: string | null;
  /** What went wrong, in the product's words. Null when nothing did. */
  problem: string | null;
  /** The platform's own reason, as recorded. Null when none was given. */
  reason: string | null;
  /** What happens next. Null when nothing is wrong. */
  next: string | null;
}

const RECONNECT = 'Reconnect it in Settings → Platforms';

export function describeSyncStatus(status: SyncStatusResponse): SyncStatusView {
  const label = platformLabel(status.platform);
  const base = {
    publishId: status.publishId,
    platform: status.platform,
    lastSyncedAt: status.lastSyncedAt,
  };

  if (status.schedule === 'disconnected') {
    return {
      ...base,
      state: 'disconnected',
      problem: `This ${label} channel is disconnected, so its figures are no longer collected.`,
      reason: null,
      next: `${RECONNECT} to collect them again.`,
    };
  }

  if (status.schedule === 'not_authorised') {
    return {
      ...base,
      state: 'not_authorised',
      problem: `This ${label} connection has not granted analytics access, so its figures are not collected.`,
      reason: null,
      next: `${RECONNECT} and allow analytics access.`,
    };
  }

  const failed =
    status.lastSyncStatus !== null && status.lastSyncStatus !== 'success';

  if (!failed) {
    return {
      ...base,
      state: status.lastSyncStatus === null ? 'not_synced_yet' : 'synced',
      problem: null,
      reason: null,
      next: null,
    };
  }

  return {
    ...base,
    state: 'failed',
    problem: failureSentence(status.lastSyncStatus, label),
    reason: status.lastError?.trim() || null,
    next: nextAttempt(status, label),
  };
}

function failureSentence(status: SyncAttemptStatus | null, label: string) {
  switch (status) {
    case 'rate_limited':
      return `${label} rate-limited the latest sync, so these figures were not refreshed.`;
    case 'scope_error':
      return `${label} refused the latest sync: it no longer accepts this channel's access.`;
    default:
      return `The latest sync from ${label} failed, so these figures were not refreshed.`;
  }
}

function nextAttempt(status: SyncStatusResponse, label: string) {
  if (status.schedule === 'eligible') {
    return 'It is tried again on the next scheduled sync.';
  }

  if (status.requiresReauth) {
    return `Syncing is paused until the ${label} channel is reconnected. ${RECONNECT}.`;
  }

  return `Automatic syncing stopped after ${status.consecutiveFailures} failed attempts in a row. ${RECONNECT} to start it again.`;
}
