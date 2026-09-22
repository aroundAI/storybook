/**
 * LinkedIn OAuth 2.0 Configuration
 * Uses LinkedIn's OAuth 2.0 with OpenID Connect
 */
import { vendorUrl } from '@kit/shared/vendors';

export const LINKEDIN_OAUTH_CONFIG = {
  authUrl: `${vendorUrl('linkedin-oauth')}/oauth/v2/authorization`,
  tokenUrl: `${vendorUrl('linkedin-oauth')}/oauth/v2/accessToken`,
  userInfoUrl: `${vendorUrl('linkedin-api')}/v2/userinfo`,
  scopes: {
    personal: ['openid', 'profile', 'email', 'w_member_social'],
    company: [
      'openid',
      'profile',
      'email',
      'w_member_social',
      'r_organization_social',
      'w_organization_social',
    ],
  },
  // Access tokens expire in 60 days
  accessTokenExpiresIn: 60 * 24 * 60 * 60,
  // Refresh tokens expire in 365 days
  refreshTokenExpiresIn: 365 * 24 * 60 * 60,
  // Refresh 5 minutes before expiry
  tokenRefreshBuffer: 5 * 60 * 1000,
} as const;

export interface LinkedInOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
  isCompanyPage?: boolean;
}
