import { META_OAUTH_DIALOG_URL } from '@kit/shared/vendors';

/**
 * Meta OAuth 2.0 Configuration
 * Uses Facebook Login for both Instagram and Facebook publishing access
 */

export const META_OAUTH_CONFIG = {
  /** Followed by the browser. Every server call goes through `metaFetch`. */
  authUrl: META_OAUTH_DIALOG_URL,
  scopes: [
    // Facebook Page publishing
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',

    // Instagram
    'instagram_basic',
    'instagram_content_publish',
    // Media and account insights on the Facebook Login path
    'instagram_manage_insights',

    // Facebook Page video insights (FILM-1720). Meta's video_insights
    // reference names both; withheld until the `facebook` switch is on.
    'read_insights',
    'pages_manage_engagement',

    // Comment text on Reels and Page videos (FILM-1733); withheld until
    // the `meta_comments` switch is on, after its own App Review
    'instagram_manage_comments',
    'pages_read_user_content',

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
