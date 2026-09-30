import {
  X_API_BASE,
  X_MEDIA_UPLOAD_SCOPE,
  X_OAUTH_AUTHORIZE_URL,
} from '@kit/shared/vendors';

import type { OAuthAppCredentials } from '../../server/oauth-app-credentials';

/**
 * Twitter/X OAuth 2.0 Configuration
 * Uses OAuth 2.0 with PKCE for secure authentication
 */

export const TWITTER_OAUTH_CONFIG = {
  authUrl: X_OAUTH_AUTHORIZE_URL,
  tokenUrl: `${X_API_BASE}/oauth2/token`,
  revokeUrl: `${X_API_BASE}/oauth2/revoke`,
  userInfoUrl: `${X_API_BASE}/users/me`,
  // Required scopes for video upload and tweet creation
  scopes: [
    'tweet.read',
    'tweet.write',
    X_MEDIA_UPLOAD_SCOPE,
    'users.read',
    'offline.access', // Required for refresh tokens
  ],
  // Access token expires in 2 hours
  accessTokenExpiry: 2 * 60 * 60 * 1000,
  // Refresh token expires in 6 months
  refreshTokenExpiry: 180 * 24 * 60 * 60 * 1000,
} as const;

/**
 * The `Authorization` header X's token endpoint takes from a confidential
 * client - for the code exchange and for refresh alike, so the two cannot
 * encode the credentials differently.
 */
export function xClientAuthorization({
  clientId,
  clientSecret,
}: OAuthAppCredentials): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export interface TwitterOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
}

/**
 * Generates a PKCE code verifier (43-128 characters, URL-safe base64)
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString('base64url');
}

/**
 * Generates a PKCE code challenge from the verifier (S256 method)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('base64url');
}
