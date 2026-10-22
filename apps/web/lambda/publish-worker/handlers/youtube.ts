/**
 * YouTube Upload Handler
 */
import { youtube as youtubeApi } from '@googleapis/youtube';
import { createReadStream, promises as fsPromises } from 'fs';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import {
  type YouTubeChannelDeclaration,
  resolveYouTubeDeclaration,
} from '@kit/publishing/lib/youtube-declaration';
import type { YouTubeStagingApi } from '@kit/publishing/lib/youtube-staged-check';
import {
  deleteVideoIfPresent,
  setVideoPublic,
  setVideoPublishAt,
  videoReadiness,
} from '@kit/publishing/lib/youtube-video-api';
import { vendorUrl } from '@kit/shared/vendors';

function youtubeClient(accessToken: string) {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  return youtubeApi({
    version: 'v3',
    auth: oauth2Client,
    rootUrl: vendorUrl('youtube-data'),
  });
}

/** KB-214: the calls the staged-upload check makes, on this channel's token */
export function youtubeStagingApi(accessToken: string): YouTubeStagingApi {
  const youtube = youtubeClient(accessToken);

  return {
    readiness: (videoIds) => videoReadiness(youtube, videoIds),
    updatePublishAt: (videoId, publishAt) =>
      setVideoPublishAt(youtube, videoId, publishAt),
    makePublic: (videoId) => setVideoPublic(youtube, videoId),
    deleteVideo: (videoId) => deleteVideoIfPresent(youtube, videoId),
  };
}

export async function uploadToYouTube(
  accessToken: string,
  job: PublishJobMessage,
  channel: YouTubeChannelDeclaration | null,
): Promise<{ contentId: string; url: string; thumbnailError?: string }> {
  // KB-30: before anything is fetched or sent. With no declaration from the
  // publish row or the channel, nothing uploads.
  const declaration = resolveYouTubeDeclaration(job.metadata, channel);

  const youtube = youtubeClient(accessToken);

  // 1. Get video file as stream
  const videoStream = await getVideoStream(job.videoUrl);
  const fileSize = await getFileSize(job.videoUrl);

  console.log(
    `[YouTube] Uploading video (${Math.round(fileSize / 1024 / 1024)}MB)...`,
  );

  // 2. Create video resource
  const resource = {
    snippet: {
      title: job.title,
      description: job.description,
      tags: job.tags,
      categoryId: declaration.categoryId,
    },
    status: {
      // KB-214: a staged upload stays private until YouTube publishes it at
      // the post's time, or (breaking) until StoryBook does once it is HD
      ...(job.staged
        ? {
            privacyStatus: 'private',
            ...(!job.staged.goLiveWhenReady && {
              publishAt: job.staged.publishAt,
            }),
          }
        : {
            privacyStatus:
              (job.metadata.privacy as 'private' | 'unlisted' | 'public') ??
              'public',
          }),
      madeForKids: declaration.madeForKids,
      selfDeclaredMadeForKids: declaration.madeForKids,
      // FILM-1731: only a declared publish carries the field
      ...(job.aiGenerated === true && { containsSyntheticMedia: true }),
    },
  };

  // 3. Upload with resumable protocol
  const response = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: resource,
      media: {
        body: videoStream,
      },
    },
    {
      rootUrl: vendorUrl('youtube-data'),
      onUploadProgress: (evt) => {
        if (fileSize > 0 && evt.bytesRead) {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          if (progress % 20 === 0) {
            console.log(`[YouTube] Upload progress: ${progress}%`);
          }
        }
      },
    },
  );

  const videoId = response.data.id;
  if (!videoId) {
    throw new Error('Failed to get video ID from upload response');
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[YouTube] Video uploaded: ${videoUrl}`);

  // 4. Upload thumbnail if provided. Non-fatal: the video is up, and the
  // failure is recorded on the publish (KB-210)
  let thumbnailError: string | undefined;
  if (job.thumbnailUrl) {
    try {
      const thumbnailStream = await getVideoStream(job.thumbnailUrl);
      await youtube.thumbnails.set(
        {
          videoId,
          media: {
            body: thumbnailStream,
          },
        },
        { rootUrl: vendorUrl('youtube-data') },
      );
      console.log(`[YouTube] Thumbnail uploaded`);
    } catch (error) {
      thumbnailError = `YouTube refused the thumbnail: ${error instanceof Error ? error.message : String(error)}`;
      console.warn(`[YouTube] ${thumbnailError}`);
    }
  }

  return {
    contentId: videoId,
    url: videoUrl,
    ...(thumbnailError && { thumbnailError }),
  };
}

export async function deleteFromYouTube(
  accessToken: string,
  videoId: string,
): Promise<void> {
  const youtube = youtubeClient(accessToken);

  console.log(`[YouTube] Deleting video: ${videoId}`);

  await youtube.videos.delete({
    id: videoId,
  });

  console.log(`[YouTube] Video deleted: ${videoId}`);
}

async function getVideoStream(path: string): Promise<Readable> {
  if (path.startsWith('http')) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch video: ${response.status} ${response.statusText}`,
      );
    }
    if (!response.body) {
      throw new Error('Failed to fetch video stream');
    }
    return Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0],
    );
  }
  return createReadStream(path);
}

async function getFileSize(path: string): Promise<number> {
  if (path.startsWith('http')) {
    const response = await fetch(path, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(
        `Failed to get file size: ${response.status} ${response.statusText}`,
      );
    }
    return parseInt(response.headers.get('content-length') ?? '0', 10);
  }
  const stats = await fsPromises.stat(path);
  return stats.size;
}
