import {
  holdsRequirement,
  readAccountGated,
  videoSyncAuthorisation,
} from '@kit/publishing/oauth/analytics-scopes';

import type { SyncMetadata } from './types';

/**
 * FILM-1711. Whether a publish is worth a vendor call, decided from what its
 * connection was granted rather than from the last call having failed.
 *
 * Pure, and separate from the sync job, because every case that matters is a
 * combination of two records and no network.
 */

/** What the OAuth callback recorded about a connection's grant. */
export interface ConnectionGrant {
  scopes: string[] | null;
  /** `metadata.scopes_granted_at`: when the creator last went through OAuth. */
  grantedAt: string | null;
  /** Requirement ids the vendor refused despite the scope being held. */
  accountGated: string[];
  /** Set when the creator disconnected the channel in the app (KB-22). */
  disconnectedAt: string | null;
}

export function toConnectionGrant(row: {
  scopes?: string[] | null;
  metadata?: unknown;
  disconnected_at?: string | null;
}): ConnectionGrant {
  const grantedAt =
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as { scopes_granted_at?: unknown }).scopes_granted_at
      : undefined;

  return {
    scopes: row.scopes ?? null,
    grantedAt: typeof grantedAt === 'string' ? grantedAt : null,
    accountGated: readAccountGated(row.metadata),
    disconnectedAt: row.disconnected_at ?? null,
  };
}

export type SyncEligibility =
  /** Call the vendor. */
  | 'eligible'
  /**
   * The recorded grant lacks the analytics scope, so the call is a known
   * failure. Not tried, not counted as a failure, and not a slot in the batch:
   * it stays this way until the creator reconnects, and then clears itself.
   */
  | 'not_authorised'
  /** Failed too often, or was refused, since the creator last authorised. */
  | 'suppressed'
  /**
   * The creator disconnected the channel (KB-22). It holds no token, so a call
   * cannot succeed; skipped without counting as a failure, so the publish is
   * eligible again the moment the channel is reconnected.
   */
  | 'disconnected';

export function syncEligibility(input: {
  platform: string;
  sync: SyncMetadata | undefined;
  grant: ConnectionGrant | undefined;
  maxConsecutiveFailures: number;
}): SyncEligibility {
  const { platform, sync, grant } = input;

  if (grant?.disconnectedAt) {
    return 'disconnected';
  }

  // No connection row at all is left to the token check, which reports it.
  if (
    grant &&
    videoSyncAuthorisation({ platform, grantedScopes: grant.scopes }) ===
      'not_authorised'
  ) {
    return 'not_authorised';
  }

  const gaveUp =
    sync?.requires_reauth === true ||
    (sync?.consecutive_failures ?? 0) >= input.maxConsecutiveFailures;

  if (!gaveUp) return 'eligible';

  // Giving up is a verdict on one authorisation. When the creator has been
  // through OAuth again since the last failure, it no longer applies — without
  // this, reconnecting restores nothing for any publish that had already
  // failed, which is every publish on a connection that lacked its scope.
  const reauthorisedSince =
    grant?.grantedAt != null &&
    (sync?.last_failed_at == null || grant.grantedAt > sync.last_failed_at);

  return reauthorisedSince ? 'eligible' : 'suppressed';
}

/** Whether the YouTube revenue query may be made for this connection. */
export function mayFetchRevenue(grant: ConnectionGrant | undefined): boolean {
  return holdsRequirement('youtube.revenue', grant?.scopes);
}
