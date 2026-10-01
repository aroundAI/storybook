/**
 * Facebook Upload Handler: glue over `FacebookProvider` (FILM-1728 §7.3.C).
 * The upload itself, and every Graph call, live in the provider, so a field
 * that changes in a future Graph version is fixed once.
 */
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import { FacebookProvider } from '@kit/publishing/providers/facebook';

export async function uploadToFacebook(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  const pageId = job.metadata.pageId as string;
  if (!pageId) {
    throw new Error('Facebook page ID not provided in metadata');
  }

  console.log(`[Facebook] Starting video upload to page ${pageId}...`);

  // Meta fetches the video from its URL in one call; nothing passes
  // through the lambda.
  const { videoId } = await new FacebookProvider(
    accessToken,
    pageId,
  ).uploadVideo({
    videoPath: job.videoUrl,
    title: job.title,
    description: job.description,
    thumbnailPath: job.thumbnailUrl,
    isReel: false,
    fetchFromUrl: true,
    published: true,
  });

  if (!videoId) {
    throw new Error('Failed to get video ID from Facebook');
  }

  console.log(`[Facebook] Video uploaded: ${videoId}`);

  return {
    contentId: videoId,
    url: `https://www.facebook.com/${pageId}/videos/${videoId}`,
  };
}

export async function deleteFromFacebook(
  accessToken: string,
  videoId: string,
): Promise<void> {
  console.log(`[Facebook] Deleting video: ${videoId}`);

  // Deleting a video by its id needs no Page.
  await new FacebookProvider(accessToken, '').deleteVideo(videoId);

  console.log(`[Facebook] Video deleted: ${videoId}`);
}
