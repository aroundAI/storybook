/**
 * Instagram Upload Handler: glue over `InstagramProvider` (FILM-1728 §7.3.C).
 * The container → poll → publish → permalink flow, and every Graph call, live
 * in the provider, so a field that changes in a future Graph version is fixed
 * once.
 */
import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import { InstagramProvider } from '@kit/publishing/providers/instagram';

export async function uploadToInstagram(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  const accountId = job.metadata.accountId as string;
  if (!accountId) {
    throw new Error('Instagram account ID not provided in metadata');
  }

  console.log(`[Instagram] Starting video upload to account ${accountId}...`);

  const result = await new InstagramProvider(accessToken, accountId).uploadReel(
    {
      videoUrl: job.videoUrl,
      caption: `${job.title}\n\n${job.description}`,
      shareToFeed: true,
    },
  );

  if (result.status !== 'FINISHED') {
    throw new Error(
      `Instagram video processing failed: ${result.errorMessage ?? result.status}`,
    );
  }

  console.log(`[Instagram] Published: ${result.mediaId}`);

  // A post without a link is a failure, never a made-up URL.
  if (!result.permalink) {
    throw new Error(
      `Instagram published (ID: ${result.mediaId}) but failed to retrieve a valid permalink.`,
    );
  }

  return { contentId: result.mediaId, url: result.permalink };
}
