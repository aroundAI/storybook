/**
 * LinkedIn Upload Handler
 */
import { vendorUrl } from '@kit/shared/vendors';

import type { PublishJobMessage } from '../index';

export async function uploadToLinkedIn(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  // Get organization/person URN from metadata
  const authorUrn = job.metadata.authorUrn as string;
  if (!authorUrn) {
    throw new Error('LinkedIn author URN not provided in metadata');
  }

  console.log(`[LinkedIn] Starting video upload for ${authorUrn}...`);

  // Step 1: Register upload
  const registerResponse = await fetch(
    `${vendorUrl('linkedin-api')}/v2/assets?action=registerUpload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
          owner: authorUrn,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            },
          ],
        },
      }),
    },
  );

  if (!registerResponse.ok) {
    const error = await registerResponse.text();
    throw new Error(`LinkedIn register upload failed: ${error}`);
  }

  const registerData = await registerResponse.json();
  const asset = registerData.value?.asset;
  const uploadUrl =
    registerData.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;

  if (!asset || !uploadUrl) {
    throw new Error('Failed to get upload URL from LinkedIn');
  }

  console.log(`[LinkedIn] Upload URL obtained, uploading video...`);

  // Step 2: Upload the video
  const videoResponse = await fetch(job.videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to fetch video: ${videoResponse.status}`);
  }
  const videoBuffer = await videoResponse.arrayBuffer();

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`LinkedIn video upload failed: ${error}`);
  }

  console.log(`[LinkedIn] Video uploaded, creating share...`);

  // Step 3: Create share with video
  const shareResponse = await fetch(
    `${vendorUrl('linkedin-api')}/v2/ugcPosts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: `${job.title}\n\n${job.description}`,
            },
            shareMediaCategory: 'VIDEO',
            media: [
              {
                status: 'READY',
                media: asset,
                title: {
                  text: job.title,
                },
              },
            ],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      }),
    },
  );

  if (!shareResponse.ok) {
    const error = await shareResponse.text();
    throw new Error(`LinkedIn share creation failed: ${error}`);
  }

  const shareData = await shareResponse.json();
  const postId = shareData.id;

  console.log(`[LinkedIn] Share created: ${postId}`);

  // Extract activity ID for URL
  const activityId = postId?.split(':').pop() || postId;

  return {
    contentId: postId,
    url: `https://www.linkedin.com/feed/update/${activityId}`,
  };
}
