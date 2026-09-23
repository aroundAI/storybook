import 'server-only';

import { getOAuthAppCredentials } from '../../server/oauth-app-credentials';
import { type RevokeOutcome, requestRevocation } from '../revoke-request';
import { TWITTER_OAUTH_CONFIG } from './config';

/**
 * X's token revocation. **Not wired into disconnect yet**: `REVOKERS.twitter`
 * is `notImplemented` until KB-25 routes it here and proves it against a
 * local listener. The app's client credentials come from the resolver
 * connect and refresh use (KB-29).
 */
export async function revokeTwitterAccess(
  accessToken: string,
): Promise<RevokeOutcome> {
  const app = await getOAuthAppCredentials('twitter');

  if (!app) {
    return { status: 'not_configured' };
  }

  const basicAuth = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString(
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
