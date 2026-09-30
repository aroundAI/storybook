/**
 * Twitter (X) Upload Handler
 */
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import {
  X_API_BASE,
  X_MEDIA_UPLOAD,
  X_MEDIA_UPLOAD_SCOPE,
  xPostUrl,
} from '@kit/shared/vendors';

export async function uploadToTwitter(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  console.log(`[Twitter] Starting video upload...`);

  // 1. Fetch the video file
  const videoResponse = await fetch(job.videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);
  }
  const videoBlob = await videoResponse.blob();
  const totalBytes = videoBlob.size;
  console.log(`[Twitter] Video fetched: ${totalBytes} bytes`);

  // 2. INIT
  const initRes = await fetch(X_MEDIA_UPLOAD.initialize, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      media_type: 'video/mp4',
      total_bytes: totalBytes,
      media_category: 'tweet_video',
    }),
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    // Every connection made before the scope was requested lands here, and
    // X's own body does not say which scope it wanted.
    const hint =
      initRes.status === 403
        ? ` (the connection may lack the ${X_MEDIA_UPLOAD_SCOPE} scope)`
        : '';

    throw new Error(`Twitter INIT failed: ${initRes.status}${hint} ${text}`);
  }

  const initData = await initRes.json();
  const mediaId: string | undefined = initData.data?.id;

  if (!mediaId) {
    throw new Error('Twitter INIT failed: missing media id');
  }
  console.log(`[Twitter] Media initialized: ${mediaId}`);

  // 3. APPEND (Chunked)
  const chunkSize = 1 * 1024 * 1024; // 1MB chunks
  const totalChunks = Math.ceil(totalBytes / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = videoBlob.slice(start, end);
    const chunkBuffer = await chunk.arrayBuffer();

    // Construct FormData manually or use native FormData
    const formData = new FormData();
    formData.append('segment_index', i.toString());
    formData.append('media', new Blob([chunkBuffer]));

    const appendRes = await fetch(X_MEDIA_UPLOAD.append(mediaId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Note: fetch with FormData automatically sets Content-Type to multipart/form-data with boundary
      },
      body: formData,
    });

    if (!appendRes.ok) {
      const text = await appendRes.text();
      throw new Error(`Twitter APPEND failed (chunk ${i}): ${text}`);
    }
    console.log(`[Twitter] Chunk ${i + 1}/${totalChunks} uploaded`);
  }

  // 4. FINALIZE
  const finalizeRes = await fetch(X_MEDIA_UPLOAD.finalize(mediaId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!finalizeRes.ok) {
    const text = await finalizeRes.text();
    throw new Error(`Twitter FINALIZE failed: ${text}`);
  }

  const finalizeData = await finalizeRes.json();

  // 5. STATUS Check (Polling)
  // Possible states: pending, in_progress, failed, succeeded
  let processing = finalizeData.data?.processing_info;

  while (
    processing?.state === 'pending' ||
    processing?.state === 'in_progress'
  ) {
    const checkAfter = processing.check_after_secs ?? 1;
    console.log(`[Twitter] Processing... waiting ${checkAfter}s`);
    await new Promise((r) => setTimeout(r, checkAfter * 1000));

    const statusRes = await fetch(X_MEDIA_UPLOAD.status(mediaId), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!statusRes.ok) {
      throw new Error('Twitter STATUS check failed');
    }

    processing = (await statusRes.json()).data?.processing_info;
  }

  if (processing?.state === 'failed') {
    throw new Error(
      `Twitter processing failed: ${processing.error?.message ?? 'unknown error'}`,
    );
  }
  console.log(`[Twitter] Media processed successfully`);

  // 6. Create Tweet (V2 API)
  const tweetRes = await fetch(`${X_API_BASE}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: `${job.title}\n\n${job.description}`,
      media: { media_ids: [mediaId] },
    }),
  });

  if (!tweetRes.ok) {
    const text = await tweetRes.text();
    throw new Error(`Twitter tweet creation failed: ${text}`);
  }

  const tweetData = await tweetRes.json();
  const tweetId = tweetData.data.id;

  return {
    contentId: tweetId,
    url: xPostUrl(tweetId),
  };
}

export async function deleteFromTwitter(
  accessToken: string,
  tweetId: string,
): Promise<void> {
  console.log(`[Twitter] Deleting tweet: ${tweetId}`);

  const response = await fetch(`${X_API_BASE}/tweets/${tweetId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twitter delete failed: ${response.status} ${error}`);
  }

  const { data } = await response.json();

  if (!data?.deleted) {
    throw new Error(`Twitter delete failed: tweet ${tweetId} was not deleted`);
  }

  console.log(`[Twitter] Tweet deleted: ${tweetId}`);
}
