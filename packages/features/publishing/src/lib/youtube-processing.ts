import { YOUTUBE_VERIFY_URL } from './youtube-long-uploads';

/**
 * KB-205. What YouTube did with an upload after accepting its bytes, from
 * `videos.list part=processingDetails,status`
 * (https://developers.google.com/youtube/v3/docs/videos#status.uploadStatus,
 * #processingDetails.processingStatus). A `videos.insert` that returns an id
 * says only that the file arrived: YouTube can still abandon it, as it does
 * a video too long for an unverified channel.
 */

/** `publishes.metadata` key of a settled verdict */
export const YOUTUBE_PROCESSING_KEY = 'youtube_processing';

export interface YouTubeVideoState {
  status?: {
    uploadStatus?: string | null;
    rejectionReason?: string | null;
    failureReason?: string | null;
  } | null;
  processingDetails?: {
    processingStatus?: string | null;
    processingFailureReason?: string | null;
  } | null;
}

export type YouTubeProcessingVerdict =
  | { state: 'failed'; reason: string; error: string }
  | { state: 'processed' }
  | { state: 'pending' };

function failed(reason: string, error: string): YouTubeProcessingVerdict {
  return { state: 'failed', reason, error };
}

export function youtubeProcessingVerdict(
  video: YouTubeVideoState,
): YouTubeProcessingVerdict {
  const uploadStatus = video.status?.uploadStatus;
  const processingStatus = video.processingDetails?.processingStatus;

  if (uploadStatus === 'rejected') {
    const reason = video.status?.rejectionReason ?? 'unspecified';

    return failed(
      `rejected: ${reason}`,
      reason === 'length'
        ? `YouTube rejected this video: it is longer than the channel may upload (rejectionReason: length). Verify the channel at ${YOUTUBE_VERIFY_URL}, then publish it again.`
        : `YouTube rejected this video (rejectionReason: ${reason}).`,
    );
  }

  if (uploadStatus === 'failed') {
    const reason = video.status?.failureReason ?? 'unspecified';

    return failed(
      `failed: ${reason}`,
      `YouTube could not process this video (failureReason: ${reason}).`,
    );
  }

  if (processingStatus === 'failed' || processingStatus === 'terminated') {
    const reason =
      video.processingDetails?.processingFailureReason ?? 'unspecified';

    return failed(
      `processing ${processingStatus}: ${reason}`,
      `YouTube abandoned processing this video (processingStatus: ${processingStatus}, reason: ${reason}).`,
    );
  }

  if (uploadStatus === 'processed' || processingStatus === 'succeeded') {
    return { state: 'processed' };
  }

  return { state: 'pending' };
}
