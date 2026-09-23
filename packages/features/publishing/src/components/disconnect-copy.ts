import type { PlatformType } from '../types';

/**
 * What the disconnect dialog says about each platform (KB-22). Kept apart
 * from the component so the sentences can be checked against what the code
 * does, and safe to import from the client: nothing here is server-only.
 */

/**
 * Whether disconnecting asks the platform to revoke our access. The dialog's
 * promise; `REVOKERS` in `oauth/revokers.ts` is the behaviour, and
 * `disconnect-copy.test.ts` fails if the two disagree. X and LinkedIn turn
 * true with KB-25.
 */
export const VENDOR_REVOKES: Record<PlatformType, boolean> = {
  youtube: true,
  tiktok: true,
  instagram: true,
  facebook: true,
  twitter: false,
  linkedin: false,
};

/**
 * Whether the statistics collected from the platform are deleted after an
 * in-app disconnect. YouTube only: its API policies require it within 7 days
 * (KB-20, owner decision 2026-09-22). Every other platform keeps them until
 * the creator asks.
 */
export const DELETES_STATISTICS_ON_DISCONNECT: Record<PlatformType, boolean> = {
  youtube: true,
  tiktok: false,
  instagram: false,
  facebook: false,
  twitter: false,
  linkedin: false,
};

export interface DisconnectCopy {
  revokeKey: string;
  vendorDataKey: string;
  /** The vendor-data sentence ends with a link to the data-deletion page. */
  linksToDataDeletion: boolean;
}

export function disconnectCopyFor(platform: PlatformType): DisconnectCopy {
  const deletesStatistics = DELETES_STATISTICS_ON_DISCONNECT[platform];

  return {
    revokeKey: VENDOR_REVOKES[platform]
      ? 'platforms:disconnectDialog.revokeAsks'
      : 'platforms:disconnectDialog.revokeNotYet',
    vendorDataKey: deletesStatistics
      ? 'platforms:disconnectDialog.vendorDataYouTube'
      : 'platforms:disconnectDialog.vendorDataKept',
    linksToDataDeletion: !deletesStatistics,
  };
}
