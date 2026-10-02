import 'server-only';

import { decrypt } from '@kit/shared/crypto';

import type { PlatformType } from '../types';
import { revokeMetaAccess } from './meta/revoke';
import type { RevokeOutcome, RevokeTokens, Revoker } from './revoke-request';
import { revokeTikTokAccess } from './tiktok/revoke';
import { revokeTwitterAccess } from './twitter/revoke';
import { revokeYouTubeAccess } from './youtube/revoke';

/**
 * How each platform is asked to revoke our access on disconnect.
 *
 * A `Record` over every `PlatformType`, so a platform added to the union does
 * not compile until it says how it is revoked. Before KB-22 this was a
 * `switch` whose X branch skipped revocation without anyone having decided
 * to; KB-25 wired X.
 * `VENDOR_REVOKES` in `disconnect-copy.ts` is what the dialog says about each
 * platform, and a unit test holds the two to the same answer.
 */
export const REVOKERS: Record<PlatformType, Revoker> = {
  youtube: revokeYouTubeAccess,
  tiktok: revokeTikTokAccess,
  instagram: revokeMetaAccess,
  facebook: revokeMetaAccess,
  twitter: revokeTwitterAccess,
};

/** Every supported platform's vendor offers a revoke today (KB-25). */
export function revokesAtVendor(platform: PlatformType): boolean {
  return platform in REVOKERS;
}

/**
 * Asks the platform to revoke the stored grant. Never throws: the disconnect
 * goes ahead whatever the platform says, and the outcome is only logged.
 */
export async function revokeAtVendor(connection: {
  platform: PlatformType;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
}): Promise<RevokeOutcome> {
  if (!connection.access_token_encrypted) {
    return { status: 'no_token' };
  }

  let tokens: RevokeTokens;

  try {
    tokens = {
      accessToken: await decrypt(connection.access_token_encrypted),
      refreshToken: connection.refresh_token_encrypted
        ? await decrypt(connection.refresh_token_encrypted)
        : null,
    };
  } catch {
    return { status: 'undecryptable' };
  }

  return REVOKERS[connection.platform](tokens);
}
