import 'server-only';

import { decrypt } from '@kit/shared/crypto';

import type { PlatformType } from '../types';
import { revokeMetaAccess } from './meta/revoke';
import type { RevokeOutcome, RevokeTokens, Revoker } from './revoke-request';
import { revokeTikTokAccess } from './tiktok/revoke';
import { revokeTwitterAccess } from './twitter/revoke';
import { revokeYouTubeAccess } from './youtube/revoke';

/**
 * LinkedIn documents no endpoint for an app to revoke its own access. Checked
 * 2026-09-24 (KB-25), every page under learn.microsoft.com's LinkedIn
 * `shared/authentication` contents: the 3-legged flow (only
 * `/oauth/v2/authorization` and `/oauth/v2/accessToken`), native PKCE,
 * programmatic refresh tokens, client credentials and token introspection —
 * whose `/oauth/v2/introspectToken` reports `status: revoked` but revokes
 * nothing. An undocumented endpoint is not called on a guess: the creator is
 * told to remove access in LinkedIn's settings instead.
 */
const vendorOffersNone: Revoker = async () => ({
  status: 'vendor_offers_none',
});

/**
 * How each platform is asked to revoke our access on disconnect.
 *
 * A `Record` over every `PlatformType`, so a platform added to the union does
 * not compile until it says how it is revoked — or records, with
 * `vendorOffersNone`, that its vendor gives apps no way to. Before KB-22 this
 * was a `switch` whose X/LinkedIn branch skipped revocation without anyone
 * having decided to; KB-25 wired X and settled LinkedIn.
 * `VENDOR_REVOKES` in `disconnect-copy.ts` is what the dialog says about each
 * platform, and a unit test holds the two to the same answer.
 */
export const REVOKERS: Record<PlatformType, Revoker> = {
  youtube: revokeYouTubeAccess,
  tiktok: revokeTikTokAccess,
  instagram: revokeMetaAccess,
  facebook: revokeMetaAccess,
  twitter: revokeTwitterAccess,
  linkedin: vendorOffersNone,
};

export function revokesAtVendor(platform: PlatformType): boolean {
  return REVOKERS[platform] !== vendorOffersNone;
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
