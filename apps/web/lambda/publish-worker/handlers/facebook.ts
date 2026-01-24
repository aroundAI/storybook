/**
 * Facebook Upload Handler
 */
import type { PublishJobMessage } from '../index';

export async function uploadToFacebook(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  // Get page ID from metadata
  const pageId = job.metadata.pageId as string;
  if (!pageId) {
    throw new Error('Facebook page ID not provided in metadata');
  }

  console.log(`[Facebook] Starting video upload to page ${pageId}...`);

  // Prepare FormData for upload
  const formData = new FormData();
  formData.append('access_token', accessToken);
  formData.append('file_url', job.videoUrl);
  formData.append('title', job.title);
  formData.append('description', job.description);
  formData.append('published', 'true');

  // Handle thumbnail - download and append as file
  if (job.thumbnailUrl) {
    try {
      console.log(
        `[Facebook] Downloading thumbnail from ${job.thumbnailUrl}...`,
      );
      const thumbResponse = await fetch(job.thumbnailUrl);
      if (thumbResponse.ok) {
        const thumbBlob = await thumbResponse.blob();
        formData.append('thumb', thumbBlob, 'thumbnail.jpg');
      } else {
        console.warn(
          `[Facebook] Failed to download thumbnail: ${thumbResponse.status} ${thumbResponse.statusText}`,
        );
      }
    } catch (error) {
      console.warn(`[Facebook] Error downloading thumbnail:`, error);
    }
  }

  // Upload video via resumable upload API (using FormData for mixed content)
  const response = await fetch(
    `https://graph-video.facebook.com/v19.0/${pageId}/videos`,
    {
      method: 'POST',
      body: formData,
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Facebook upload failed: ${error}`);
  }

  const data = await response.json();
  const videoId = data.id;

  if (!videoId) {
    throw new Error('Failed to get video ID from Facebook');
  }

  console.log(`[Facebook] Video uploaded: ${videoId}`);

  return {
    contentId: videoId,
    url: `https://www.facebook.com/${pageId}/videos/${videoId}`,
  };
}
