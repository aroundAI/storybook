/**
 * YouTube Upload Handler
 */
import { youtube as youtubeApi } from '@googleapis/youtube';
import { createReadStream, promises as fsPromises } from 'fs';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

import type { PublishJobMessage } from '../index';

export async function uploadToYouTube(
  accessToken: string,
  job: PublishJobMessage,
): Promise<{ contentId: string; url: string }> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtube = youtubeApi({ version: 'v3', auth: oauth2Client });

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
      categoryId: (job.metadata.categoryId as string) ?? '22',
    },
    status: {
      privacyStatus:
        (job.metadata.privacy as 'private' | 'unlisted' | 'public') ?? 'public',
      madeForKids: (job.metadata.madeForKids as boolean) ?? false,
      selfDeclaredMadeForKids: (job.metadata.madeForKids as boolean) ?? false,
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

  // 4. Upload thumbnail if provided (non-fatal)
  if (job.thumbnailUrl) {
    try {
      const thumbnailStream = await getVideoStream(job.thumbnailUrl);
      await youtube.thumbnails.set({
        videoId,
        media: {
          body: thumbnailStream,
        },
      });
      console.log(`[YouTube] Thumbnail uploaded`);
    } catch (thumbnailError) {
      // Don't fail the upload if thumbnail fails
      console.warn(
        `[YouTube] Thumbnail upload failed: ${thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError)}`,
      );
    }
  }

  return { contentId: videoId, url: videoUrl };
}

export async function deleteFromYouTube(
  accessToken: string,
  videoId: string,
): Promise<void> {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtube = youtubeApi({ version: 'v3', auth: oauth2Client });

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
