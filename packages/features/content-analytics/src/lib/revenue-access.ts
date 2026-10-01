import {
  type ConnectionRevenueState,
  type MonetisationAccessState,
  monetisationAccess,
} from '@kit/clickhouse';
import type { AnalyticsPlatform } from '@kit/clickhouse';

/**
 * Why a revenue figure is "Not measured", one sentence per reason
 * (FILM-1726). A project's channels can each be missing earnings for a
 * different reason, with a different owner: the platform's (TikTok reports
 * none), the creator's (outside the Partner Program) or ours (a connection
 * made before we asked for the scope).
 *
 * Pure and client-safe. The per-connection state comes from
 * `resolveAnalyticsAccess` (publishing), on the server.
 */
export interface RevenueAccessNote {
  platform: AnalyticsPlatform;
  state: MonetisationAccessState;
  owner: 'platform' | 'creator' | 'us';
  note: string;
}

/** One connection: its platform and, where one covers revenue, that requirement's state. */
export interface RevenueAccessConnection {
  platform: string;
  /** `resolveAnalyticsAccess`'s entries, or null for a platform it does not cover. */
  entries: ReadonlyArray<{ requirementId: string; state: string }> | null;
}

const PLATFORMS: readonly AnalyticsPlatform[] = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
];

const CONNECTION_STATES: readonly string[] = [
  'authorised',
  'unknown',
  'scope_missing',
  'review_pending',
  'not_requested',
  'account_type_gated',
] satisfies readonly ConnectionRevenueState[];

function isPlatform(platform: string): platform is AnalyticsPlatform {
  return (PLATFORMS as readonly string[]).includes(platform);
}

function revenueState(
  platform: AnalyticsPlatform,
  entries: RevenueAccessConnection['entries'],
): ConnectionRevenueState | null {
  const state = entries?.find(
    (entry) => entry.requirementId === `${platform}.revenue`,
  )?.state;

  return state && CONNECTION_STATES.includes(state)
    ? (state as ConnectionRevenueState)
    : null;
}

/**
 * The reasons, one per platform and sentence, in platform order. A
 * connection whose revenue nothing stands in the way of contributes none:
 * its absence of a figure is a day with no earnings reported, not a reason.
 */
export function revenueAccessNotes(
  connections: readonly RevenueAccessConnection[],
): RevenueAccessNote[] {
  const notes = new Map<string, RevenueAccessNote>();

  for (const connection of connections) {
    if (!isPlatform(connection.platform)) continue;

    const access = monetisationAccess(connection.platform, {
      revenue: revenueState(connection.platform, connection.entries),
    });

    if (access.owner === null) continue;

    notes.set(`${connection.platform}:${access.note}`, {
      platform: connection.platform,
      state: access.state,
      owner: access.owner,
      note: access.note,
    });
  }

  return [...notes.values()].sort(
    (a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform),
  );
}
