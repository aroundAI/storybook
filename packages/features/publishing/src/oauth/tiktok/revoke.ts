import 'server-only';

import { getOAuthAppCredentials } from '../../server/oauth-app-credentials';
import {
  type RevokeOutcome,
  type RevokeTokens,
  requestRevocation,
} from '../revoke-request';
import { TIKTOK_OAUTH_CONFIG } from './config';

/**
 * Revokes the grant at TikTok. TikTok's revoke call needs the app's own
 * client key and secret — from the same resolver connect and refresh use
 * (KB-29), so all three agree on which app the token belongs to.
 */
export async function revokeTikTokAccess({
  accessToken,
}: RevokeTokens): Promise<RevokeOutcome> {
  const app = await getOAuthAppCredentials('tiktok');

  if (!app) {
    return { status: 'not_configured' };
  }

  return requestRevocation(TIKTOK_OAUTH_CONFIG.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: app.clientId,
      client_secret: app.clientSecret,
      token: accessToken,
    }),
  });
}
