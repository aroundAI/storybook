/**
 * Twitter/X OAuth 2.0 Configuration
 * Uses OAuth 2.0 with PKCE for secure authentication
 */

export const TWITTER_OAUTH_CONFIG = {
  authUrl: 'https://twitter.com/i/oauth2/authorize',
  tokenUrl: 'https://api.twitter.com/2/oauth2/token',
  revokeUrl: 'https://api.twitter.com/2/oauth2/revoke',
  userInfoUrl: 'https://api.twitter.com/2/users/me',
  // Required scopes for video upload and tweet creation
  scopes: [
    'tweet.read',
    'tweet.write',
    'users.read',
    'offline.access', // Required for refresh tokens
  ],
  // Access token expires in 2 hours
  accessTokenExpiry: 2 * 60 * 60 * 1000,
  // Refresh token expires in 6 months
  refreshTokenExpiry: 180 * 24 * 60 * 60 * 1000,
} as const;

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
