import 'server-only';

import { type RevokeOutcome, requestRevocation } from '../revoke-request';
import { TWITTER_OAUTH_CONFIG } from './config';

/**
 * X's token revocation. **Not wired into disconnect yet**: `REVOKERS.twitter`
 * is `notImplemented` until KB-25 routes it here and proves it against a
 * local listener. The app's client credentials are read from the environment
 * (KB-29 moves them to its credential resolver).
 */
export async function revokeTwitterAccess(
  accessToken: string,
): Promise<RevokeOutcome> {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { status: 'not_configured' };
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  );

  return requestRevocation(TWITTER_OAUTH_CONFIG.revokeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      token: accessToken,
      token_type_hint: 'access_token',
    }),
  });
}
