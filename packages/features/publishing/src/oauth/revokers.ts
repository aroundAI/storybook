import 'server-only';

import { decrypt } from '@kit/shared/crypto';

import type { PlatformType } from '../types';
import { revokeMetaAccess } from './meta/revoke';
import type { RevokeOutcome, Revoker } from './revoke-request';
import { revokeTikTokAccess } from './tiktok/revoke';
import { revokeYouTubeAccess } from './youtube/revoke';

const notImplemented: Revoker = async () => ({ status: 'not_implemented' });

/**
 * How each platform is asked to revoke our access on disconnect.
 *
 * A `Record` over every `PlatformType`, so a platform added to the union does
 * not compile until it says how it is revoked — or says, with
 * `notImplemented`, that it is not. Before KB-22 this was a `switch` whose
 * X/LinkedIn branch skipped revocation without anyone having decided to.
 *
 * X and LinkedIn are KB-25: X's call exists (`twitter/revoke.ts`) and is not
 * yet proven; LinkedIn has none. `VENDOR_REVOKES` in `disconnect-copy.ts` is
 * what the dialog says about each platform, and a unit test holds the two to
 * the same answer.
 */
export const REVOKERS: Record<PlatformType, Revoker> = {
  youtube: revokeYouTubeAccess,
  tiktok: revokeTikTokAccess,
  instagram: revokeMetaAccess,
  facebook: revokeMetaAccess,
  twitter: notImplemented,
  linkedin: notImplemented,
};

export function revokesAtVendor(platform: PlatformType): boolean {
  return REVOKERS[platform] !== notImplemented;
}

/**
 * Asks the platform to revoke the stored grant. Never throws: the disconnect
 * goes ahead whatever the platform says, and the outcome is only logged.
 */
export async function revokeAtVendor(connection: {
  platform: PlatformType;
  access_token_encrypted: string | null;
}): Promise<RevokeOutcome> {
  if (!connection.access_token_encrypted) {
    return { status: 'no_token' };
  }

  let accessToken: string;

  try {
    accessToken = await decrypt(connection.access_token_encrypted);
  } catch {
    return { status: 'undecryptable' };
  }

  return REVOKERS[connection.platform](accessToken);
}
