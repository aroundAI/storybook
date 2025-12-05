/**
 * YouTube OAuth 2.0 Configuration
 * Uses Google OAuth with YouTube-specific scopes
 */

export const YOUTUBE_OAUTH_CONFIG = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ],
  // Token expires in 1 hour, refresh 5 minutes before
  tokenRefreshBuffer: 5 * 60 * 1000,
} as const;

export interface YouTubeOAuthState {
  accountId: string;
  returnUrl: string;
  nonce: string;
}

/**
 * YouTube video categories (US region)
 * Fetch dynamically via API for other regions
 */
export const YOUTUBE_CATEGORIES = [
  { id: '1', title: 'Film & Animation' },
  { id: '2', title: 'Autos & Vehicles' },
  { id: '10', title: 'Music' },
  { id: '15', title: 'Pets & Animals' },
  { id: '17', title: 'Sports' },
  { id: '19', title: 'Travel & Events' },
  { id: '20', title: 'Gaming' },
  { id: '22', title: 'People & Blogs' },
  { id: '23', title: 'Comedy' },
  { id: '24', title: 'Entertainment' },
  { id: '25', title: 'News & Politics' },
  { id: '26', title: 'Howto & Style' },
  { id: '27', title: 'Education' },
  { id: '28', title: 'Science & Technology' },
  { id: '29', title: 'Nonprofits & Activism' },
] as const;
