/**
 * Twitter (X) Upload Handler
 */
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

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
  const initParams = new URLSearchParams({
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: 'video/mp4',
    media_category: 'tweet_video',
  });

  const initRes = await fetch(
    'https://upload.twitter.com/1.1/media/upload.json',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: initParams,
    },
  );

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Twitter INIT failed: ${text}`);
  }

  const initData = await initRes.json();
  const mediaId = initData.media_id_string;
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
    formData.append('command', 'APPEND');
    formData.append('media_id', mediaId);
    formData.append('segment_index', i.toString());
    formData.append('media', new Blob([chunkBuffer]));

    const appendRes = await fetch(
      'https://upload.twitter.com/1.1/media/upload.json',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Note: fetch with FormData automatically sets Content-Type to multipart/form-data with boundary
        },
        body: formData,
      },
    );

    if (!appendRes.ok) {
      const text = await appendRes.text();
      throw new Error(`Twitter APPEND failed (chunk ${i}): ${text}`);
    }
    console.log(`[Twitter] Chunk ${i + 1}/${totalChunks} uploaded`);
  }

  // 4. FINALIZE
  const finalizeParams = new URLSearchParams({
    command: 'FINALIZE',
    media_id: mediaId,
  });

  const finalizeRes = await fetch(
    'https://upload.twitter.com/1.1/media/upload.json',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: finalizeParams,
    },
  );

  if (!finalizeRes.ok) {
    const text = await finalizeRes.text();
    throw new Error(`Twitter FINALIZE failed: ${text}`);
  }

  const finalizeData = await finalizeRes.json();

  // 5. STATUS Check (Polling)
  if (finalizeData.processing_info) {
    let state = finalizeData.processing_info.state;
    // Possible states: pending, in_progress, failed, succeeded

    while (state === 'pending' || state === 'in_progress') {
      const checkAfter = finalizeData.processing_info.check_after_secs || 1;
      console.log(`[Twitter] Processing... waiting ${checkAfter}s`);
      await new Promise((r) => setTimeout(r, checkAfter * 1000));

      const statusParams = new URLSearchParams({
        command: 'STATUS',
        media_id: mediaId,
      });

      const statusRes = await fetch(
        `https://upload.twitter.com/1.1/media/upload.json?${statusParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!statusRes.ok) {
        throw new Error('Twitter STATUS check failed');
      }

      const statusData = await statusRes.json();
      state = statusData.processing_info.state;

      if (state === 'failed') {
        throw new Error(
          `Twitter processing failed: ${statusData.processing_info.error?.message}`,
        );
      }
    }
  }
  console.log(`[Twitter] Media processed successfully`);

  // 6. Create Tweet (V2 API)
  const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
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

  // Construct URL
  // Twitter username is difficult to get from V2 without another call, so we use generic format
  // or user will be redirected. Actually 'x.com/i/web/status/<id>' works.

  return {
    contentId: tweetId,
    url: `https://x.com/i/web/status/${tweetId}`,
  };
}
