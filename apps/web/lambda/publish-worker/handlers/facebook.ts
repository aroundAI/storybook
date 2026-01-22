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

    // Upload video via resumable upload API
    const response = await fetch(
        `https://graph-video.facebook.com/v19.0/${pageId}/videos`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                access_token: accessToken,
                file_url: job.videoUrl,
                title: job.title,
                description: job.description,
                published: true,
                ...(job.thumbnailUrl && { thumb: job.thumbnailUrl }),
            }),
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
