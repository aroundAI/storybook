/**
 * Instagram Upload Handler (via Meta Graph API)
 */
import type { PublishJobMessage } from '../index';

export async function uploadToInstagram(
    accessToken: string,
    job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
    // Get Instagram account ID from metadata
    const accountId = job.metadata.accountId as string;
    if (!accountId) {
        throw new Error('Instagram account ID not provided in metadata');
    }

    console.log(`[Instagram] Starting video upload to account ${accountId}...`);

    // Step 1: Create container for video
    const containerResponse = await fetch(
        `https://graph.facebook.com/v19.0/${accountId}/media`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                access_token: accessToken,
                media_type: 'REELS',
                video_url: job.videoUrl,
                caption: `${job.title}\n\n${job.description}`,
                share_to_feed: true,
                ...(job.thumbnailUrl && { cover_url: job.thumbnailUrl }),
            }),
        },
    );

    if (!containerResponse.ok) {
        const error = await containerResponse.text();
        throw new Error(`Instagram container creation failed: ${error}`);
    }

    const containerData = await containerResponse.json();
    const containerId = containerData.id;

    if (!containerId) {
        throw new Error('Failed to get container ID from Instagram');
    }

    console.log(`[Instagram] Container created: ${containerId}`);

    // Step 2: Poll for container to be ready
    const maxAttempts = 60;
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const statusResponse = await fetch(
            `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`,
        );

        if (!statusResponse.ok) {
            console.warn(`[Instagram] Status check failed, retrying...`);
            continue;
        }

        const statusData = await statusResponse.json();
        const status = statusData.status_code;

        if (status === 'FINISHED') {
            break;
        }

        if (status === 'ERROR') {
            throw new Error('Instagram video processing failed');
        }

        console.log(`[Instagram] Processing status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);
    }

    // Step 3: Publish the container
    const publishResponse = await fetch(
        `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                access_token: accessToken,
                creation_id: containerId,
            }),
        },
    );

    if (!publishResponse.ok) {
        const error = await publishResponse.text();
        throw new Error(`Instagram publish failed: ${error}`);
    }

    const publishData = await publishResponse.json();
    const mediaId = publishData.id;

    console.log(`[Instagram] Published: ${mediaId}`);

    // Construct URL (approximate, as Instagram doesn't return direct URL)
    return {
        contentId: mediaId,
        url: `https://www.instagram.com/reel/${mediaId}`,
    };
}
