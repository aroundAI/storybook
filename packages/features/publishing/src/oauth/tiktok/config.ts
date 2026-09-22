/**
 * TikTok OAuth 2.0 Configuration
 * Uses TikTok Login Kit with PKCE for Content Posting API access
 */
import { vendorUrl } from '@kit/shared/vendors';

export const TIKTOK_OAUTH_CONFIG = {
  authUrl: `${vendorUrl('tiktok-oauth')}/v2/auth/authorize/`,
  tokenUrl: `${vendorUrl('tiktok')}/v2/oauth/token/`,
  revokeUrl: `${vendorUrl('tiktok')}/v2/oauth/revoke/`,
  userInfoUrl: `${vendorUrl('tiktok')}/v2/user/info/`,
  scopes: [
    'user.info.basic',
    'video.upload',
    // Analytics: /v2/video/query/ and follower_count — see analytics-scopes.ts
    'video.list',
    'user.info.stats',
  ],
  // Access token expires in 24 hours
  accessTokenExpiry: 24 * 60 * 60 * 1000,
  // Refresh token expires in 365 days but rotates on use
  refreshTokenExpiry: 365 * 24 * 60 * 60 * 1000,
} as const;

export interface TikTokOAuthState {
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
