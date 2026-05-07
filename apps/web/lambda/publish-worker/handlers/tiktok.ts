/**
 * TikTok Upload Handler
 */
import type { PublishJobMessage } from '../index';

export async function uploadToTikTok(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  console.log(`[TikTok] Starting upload...`);

  // Step 1: Initialize video upload
  const initResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: job.title,
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: (job.metadata.disableDuet as boolean) ?? false,
          disable_stitch: (job.metadata.disableStitch as boolean) ?? false,
          disable_comment: (job.metadata.disableComments as boolean) ?? false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: job.videoUrl,
        },
      }),
    },
  );

  if (!initResponse.ok) {
    const error = await initResponse.text();
    throw new Error(`TikTok upload init failed: ${error}`);
  }

  const initData = await initResponse.json();
  const publishId = initData.data?.publish_id;

  if (!publishId) {
    throw new Error('Failed to get publish ID from TikTok');
  }

  console.log(`[TikTok] Video queued with publish_id: ${publishId}`);

  // Step 2: Poll for completion (up to 5 minutes)
  const maxAttempts = 60;
  const pollInterval = 5000;
  let status = 'PROCESSING_UPLOAD';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const statusResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );

    if (!statusResponse.ok) {
      console.warn(`[TikTok] Status check failed, retrying...`);
      continue;
    }

    const statusData = await statusResponse.json();
    status = statusData.data?.status;

    if (status === 'PUBLISH_COMPLETE') {
      const videoId = statusData.data?.video_id;
      // TikTok doesn't provide direct URL, construct from video ID
      const videoUrl = videoId
        ? `https://www.tiktok.com/@user/video/${videoId}`
        : '';

      console.log(`[TikTok] Upload complete: ${videoId}`);
      return { contentId: publishId, url: videoUrl };
    }

    if (status === 'FAILED') {
      const failReason = statusData.data?.fail_reason || 'Unknown error';
      throw new Error(`TikTok upload failed: ${failReason}`);
    }

    console.log(
      `[TikTok] Status: ${status} (attempt ${attempt + 1}/${maxAttempts})`,
    );
  }

  throw new Error(
    `TikTok upload timed out after ${maxAttempts} attempts, last status: ${status}`,
  );
}
