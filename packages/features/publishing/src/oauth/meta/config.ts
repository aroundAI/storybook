/**
 * Meta OAuth 2.0 Configuration
 * Uses Facebook Login for both Instagram and Facebook publishing access
 */

export const META_OAUTH_CONFIG = {
  authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
  tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
  graphUrl: 'https://graph.facebook.com/v18.0',
  scopes: [
    // Facebook Page publishing
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',

    // Instagram
    'instagram_basic',
    'instagram_content_publish',

    // Business features
    'business_management',
  ],
  // Short-lived token: ~1 hour
  // Long-lived token: ~60 days
  longLivedTokenExpiry: 60 * 24 * 60 * 60 * 1000,
} as const;

export interface MetaOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
  platforms: ('facebook' | 'instagram')[];
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  category: string;
  pictureUrl?: string;
  instagramAccountId?: string;
}
