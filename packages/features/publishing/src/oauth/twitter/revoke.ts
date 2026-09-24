import 'server-only';

import { getOAuthAppCredentials } from '../../server/oauth-app-credentials';
import {
  type RevokeOutcome,
  type RevokeTokens,
  requestRevocation,
} from '../revoke-request';
import { TWITTER_OAUTH_CONFIG, xClientAuthorization } from './config';

/**
 * Revokes our grant at X (KB-25), as a confidential client:
 * `POST https://api.x.com/2/oauth2/revoke`, form-encoded, Basic app auth and
 * `token=` — exactly the confidential-client example under "POST
 * oauth2/revoke - Revoke Token" at
 * https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
 * (read 2026-09-24). X documents no `token_type_hint`, so none is sent.
 *
 * X says a revoke "invalidates an access token or refresh token" and does not
 * say that revoking one revokes the other, so both are revoked: the 180-day
 * refresh token first, as the credential that matters, then the two-hour
 * access token. Both calls are always made; the outcome is `revoked` only if
 * X confirmed both.
 */
export async function revokeTwitterAccess({
  accessToken,
  refreshToken,
}: RevokeTokens): Promise<RevokeOutcome> {
  const app = await getOAuthAppCredentials('twitter');

  if (!app) {
    return { status: 'not_configured' };
  }

  const outcomes: RevokeOutcome[] = [];

  for (const token of [refreshToken, accessToken]) {
    if (!token) continue;

    outcomes.push(
      await requestRevocation(TWITTER_OAUTH_CONFIG.revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: xClientAuthorization(app),
        },
        body: new URLSearchParams({ token }),
      }),
    );
  }

  return (
    outcomes.find((outcome) => outcome.status !== 'revoked') ??
    outcomes[0] ?? { status: 'no_token' }
  );
}
