import type { PlatformType } from '../types';

/**
 * Where a creator removes StoryBook's access on each platform's own side.
 * One list for the data-deletion page (section 4) and for the warning shown
 * when a disconnect's revoke is not confirmed (KB-45), so the two cannot point
 * at different places. Safe to import from the client.
 *
 * `id` is the data-deletion page's `data-test` suffix. TikTok has no web page
 * for it, only a path in the app, so `href` is null.
 */
export interface PlatformAccessSettings {
  id: string;
  label: string;
  where: string;
  href: string | null;
}

export const PLATFORM_ACCESS_SETTINGS: Record<
  PlatformType,
  PlatformAccessSettings
> = {
  youtube: {
    id: 'google',
    label: 'YouTube (Google)',
    href: 'https://security.google.com/settings/security/permissions',
    where: 'Google Account → Security → Third-party apps with account access',
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    href: 'https://www.facebook.com/settings?tab=applications',
    where: 'Settings & Privacy → Settings → Apps and Websites',
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    href: 'https://www.instagram.com/accounts/manage_access/',
    where: 'Settings → Apps and websites',
  },
  twitter: {
    id: 'x',
    label: 'X',
    href: 'https://x.com/settings/connected_apps',
    where: 'Settings → Security and account access → Connected apps',
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/mypreferences/d/data-sharing-for-permitted-services',
    where: 'Settings → Data privacy → Permitted services',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    href: null,
    where:
      'In the TikTok app: Settings and privacy → Security & permissions → Manage app permissions',
  },
};
