import { MetadataRoute } from 'next';

import appConfig from '~/config/app.config';

/**
 * PWA Manifest for installability and SEO signals
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.name,
    short_name: appConfig.name,
    description: appConfig.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: appConfig.themeColor,
    orientation: 'portrait-primary',
    categories: ['productivity', 'entertainment', 'multimedia'],
    icons: [
      {
        src: '/images/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/images/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/images/favicon/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    screenshots: [
      {
        src: '/images/dashboard.webp',
        sizes: '1280x720',
        type: 'image/webp',
        label: 'StoryBook Dashboard',
      },
    ],
  };
}
