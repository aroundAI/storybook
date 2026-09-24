import 'server-only';

import {
  type YouTubeChannelDeclaration,
  resolveYouTubeDeclaration,
} from '../lib/youtube-declaration';
import { YouTubeProvider } from '../providers/youtube';

/**
 * The in-app YouTube upload: immediate publishes, retries and the in-app
 * scheduled-publish cron. It was two copies (publish-actions.ts and
 * process-scheduled-publishes.ts); it is one so the declaration below is
 * decided in one place.
 */
export async function uploadToYouTube(
  accessToken: string,
  options: {
    videoUrl: string;
    title: string;
    description: string;
    tags: string[];
    thumbnailUrl?: string | null;
    isShort?: boolean;
    privacy: 'private' | 'unlisted' | 'public';
    platformSpecific: Record<string, unknown>;
  },
  channel: YouTubeChannelDeclaration | null,
): Promise<{ contentId: string; url: string }> {
  // Before anything is fetched or sent: with no declaration, nothing uploads.
  const declaration = resolveYouTubeDeclaration(
    options.platformSpecific,
    channel,
  );
  const provider = new YouTubeProvider(accessToken);

  // For YouTube Shorts, add #Shorts hashtag to title and description
  let title = options.title;
  let description = options.description;
  if (options.isShort) {
    if (!title.toLowerCase().includes('#shorts')) {
      title = `${title} #Shorts`;
    }
    if (!description.toLowerCase().includes('#shorts')) {
      description = `${description}\n\n#Shorts`;
    }
  }

  const result = await provider.uploadVideo({
    videoPath: options.videoUrl,
    title,
    description,
    tags: options.tags,
    categoryId: declaration.categoryId,
    privacy: options.privacy,
    madeForKids: declaration.madeForKids,
    thumbnailPath: options.thumbnailUrl ?? undefined,
    playlistIds: options.platformSpecific.playlistIds as string[] | undefined,
  });

  return { contentId: result.videoId, url: result.videoUrl ?? '' };
}
