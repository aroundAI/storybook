import 'server-only';

import { type RevokeOutcome, requestRevocation } from '../revoke-request';
import { TIKTOK_OAUTH_CONFIG } from './config';

/**
 * Revokes the grant at TikTok. TikTok's revoke call needs the app's own
 * client key and secret, read from the environment as connect reads them
 * (KB-29 moves both to one credential resolver).
 */
export async function revokeTikTokAccess(
  accessToken: string,
): Promise<RevokeOutcome> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return { status: 'not_configured' };
  }

  return requestRevocation(TIKTOK_OAUTH_CONFIG.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      token: accessToken,
    }),
  });
}
