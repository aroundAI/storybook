import {
  PublicAccount,
  PublicEpisode,
  PublicProject,
} from '../server/public-queries';

type LocalizedVideoData = {
  youtube?: {
    video_id: string;
    url: string;
    channel_id: string;
  };
  facebook?: {
    video_id: string;
    url: string;
    page_id: string;
  };
};

/**
 * Generate Organization schema for a Company Page
 */
export function getOrganizationSchema(company: PublicAccount, baseUrl: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = company.public_profile as any; // Cast safely based on known structure

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${baseUrl}/@${company.slug}`,
    name: company.name,
    url: `${baseUrl}/@${company.slug}`,
    logo: company.picture_url,
    description: profile?.bio,
    sameAs: [
      profile?.website_url,
      profile?.social_links?.twitter,
      profile?.social_links?.youtube,
      profile?.social_links?.instagram,
      profile?.social_links?.tiktok,
    ].filter(Boolean),
  };
}

/**
 * Generate TVSeries schema for a Project Page
 */
export function getTVSeriesSchema(project: PublicProject, baseUrl: string) {
  const accountSlug = project.account.slug;
  const projectUrl = `${baseUrl}/@${accountSlug}/${project.public_slug}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    '@id': projectUrl,
    name: project.name,
    description: project.description,
    url: projectUrl,
    author: {
      '@type': 'Organization',
      '@id': `${baseUrl}/@${accountSlug}`,
      name: project.account.name,
    },
    // In a real app, we might add 'numberOfSeasons', 'numberOfEpisodes' if available
  };
}

/**
 * Generate TVEpisode schema for an Episode Page
 */
export function getTVEpisodeSchema(
  episode: PublicEpisode,
  language: string,
  baseUrl: string,
) {
  const accountSlug = episode.project.account.slug;
  const projectSlug = episode.project.public_slug;
  const episodeUrl = `${baseUrl}/@${accountSlug}/${projectSlug}/e/${episode.public_slug}`;

  const localizedVideos = (episode.localized_videos || {}) as Record<
    string,
    LocalizedVideoData
  >;
  const videoData = localizedVideos[language];

  // If no video for this language, we might fallback to english or return without video object
  // But typically we want the video object if available.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    '@id': episodeUrl,
    url: episodeUrl,
    name: episode.title,
    description: episode.description,
    episodeNumber: episode.number,
    partOfSeries: {
      '@type': 'TVSeries',
      '@id': `${baseUrl}/@${accountSlug}/${projectSlug}`,
      name: episode.project.name,
    },
  };

  if (episode.thumbnail_url) {
    schema.image = episode.thumbnail_url;
  }

  // Add VideoObject if available
  if (videoData) {
    // Prefer YouTube, then Facebook
    const videoInfo = videoData.youtube || videoData.facebook;

    // Note: embedUrl for YouTube is https://www.youtube.com/embed/ID
    // For Facebook it's harder to guess standard embed URL without more info,
    // but usually provided contentUrl is helpful.

    if (videoInfo) {
      let embedUrl = videoInfo.url;
      if (videoData.youtube) {
        embedUrl = `https://www.youtube.com/embed/${videoData.youtube.video_id}`;
      } else if (videoData.facebook) {
        // Facebook embed URL construction
        embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(videoInfo.url)}`;
      }

      schema.video = {
        '@type': 'VideoObject',
        name: episode.title,
        description: episode.description,
        thumbnailUrl: episode.thumbnail_url || '',
        uploadDate: episode.created_at, // or published_at if available
        contentUrl: videoInfo.url,
        embedUrl: embedUrl,
        interactionStatistic: {
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'WatchAction' },
          // userInteractionCount: ... // if we had views
        },
      };
    }
  }

  return schema;
}
