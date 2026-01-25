/**
 * Instagram Upload Handler (via Meta Graph API)
 */
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';

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
                // Thumbnails removed as per request
                // ...(job.thumbnailUrl && { cover_url: job.thumbnailUrl }),
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

    // Step 4: Robust Polling for Permalink
    // We poll until the permalink is available or timeout.
    // Guaranteed "tight" system: No fallback to broken links.
    const permalinkAttempts = 10;
    const permalinkInterval = 2000; // 2 seconds

    for (let i = 0; i < permalinkAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, permalinkInterval));

        try {
            const detailsResponse = await fetch(
                `https://graph.facebook.com/v19.0/${mediaId}?fields=shortcode,permalink&access_token=${accessToken}`,
            );

            if (detailsResponse.ok) {
                const details = await detailsResponse.json();

                // Return immediately if we have the permalink (Preferred)
                if (details.permalink) {
                    return {
                        contentId: mediaId,
                        url: details.permalink,
                    };
                }

                // Or if we have a shortcode (acceptable alternative)
                if (details.shortcode) {
                    return {
                        contentId: mediaId,
                        url: `https://www.instagram.com/reel/${details.shortcode}/`,
                    };
                }
            }
        } catch (err) {
            console.warn(`[Instagram] Error polling for details (attempt ${i + 1}/${permalinkAttempts}):`, err);
        }
    }

    // If we reach here, we failed to get a valid link.
    // Throw error to mark job as failed/warning rather than storing bad data.
    throw new Error(`Instagram published (ID: ${mediaId}) but failed to retrieve valid permalink after ${permalinkAttempts} attempts.`);
}
