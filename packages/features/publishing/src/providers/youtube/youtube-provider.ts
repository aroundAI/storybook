import 'server-only';

import { youtube as youtubeApi } from '@googleapis/youtube';
import { createReadStream, promises as fsPromises } from 'fs';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

import type { SubscriberCountResult } from '@kit/shared/subscribers';
import { vendorUrl } from '@kit/shared/vendors';

import type {
  YouTubeCategory,
  YouTubeChannel,
  YouTubePlaylist,
  YouTubeUploadInput,
  YouTubeUploadProgress,
  YouTubeUploadResult,
} from './types';

/**
 * YouTube Provider
 * Handles video uploads, thumbnail management, and playlist operations
 * using the YouTube Data API v3
 */
export class YouTubeProvider {
  private youtube;

  constructor(accessToken: string) {
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.youtube = youtubeApi({
      version: 'v3',
      auth: oauth2Client,
      rootUrl: vendorUrl('youtube-data'),
    });
  }

  /**
   * Uploads a video to YouTube with resumable upload support
   */
  async uploadVideo(
    input: YouTubeUploadInput,
    onProgress?: YouTubeUploadProgress,
  ): Promise<YouTubeUploadResult> {
    // 1. Get video file as stream
    const videoStream = await this.getVideoStream(input.videoPath);
    const fileSize = await this.getFileSize(input.videoPath);

    // 2. Create video resource
    const resource = {
      snippet: {
        title: input.title,
        description: input.description,
        tags: input.tags,
        categoryId: input.categoryId,
        defaultLanguage: input.defaultLanguage,
      },
      status: {
        privacyStatus: input.privacy,
        // publishAt removed - scheduling handled server-side by cron job
        madeForKids: input.madeForKids,
        selfDeclaredMadeForKids: input.madeForKids,
        // FILM-1731: only a declared publish carries the field
        ...(input.containsSyntheticMedia && { containsSyntheticMedia: true }),
      },
    };

    // 3. Upload with resumable protocol
    const response = await this.youtube.videos.insert(
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
            onProgress?.(progress);
          }
        },
      },
    );

    const videoId = response.data.id;
    if (!videoId) {
      throw new Error('Failed to get video ID from upload response');
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 4. Upload thumbnail if provided (non-fatal - video is already uploaded)
    let thumbnailUrl: string | undefined;
    if (input.thumbnailPath) {
      try {
        thumbnailUrl = await this.uploadThumbnail(videoId, input.thumbnailPath);
      } catch (thumbnailError) {
        // Log but don't fail - video is already uploaded successfully
        console.warn(
          `[YouTube] Thumbnail upload failed for video ${videoId}: ${thumbnailError instanceof Error ? thumbnailError.message : String(thumbnailError)}`,
        );
      }
    }

    // 5. Add to playlists
    if (input.playlistIds?.length) {
      await Promise.all(
        input.playlistIds.map((playlistId) =>
          this.addToPlaylist(videoId, playlistId),
        ),
      );
    }

    return {
      videoId,
      videoUrl,
      status: 'published', // Always published - scheduling handled server-side
      thumbnailUrl,
    };
  }

  /**
   * Uploads a custom thumbnail for a video
   */
  async uploadThumbnail(
    videoId: string,
    thumbnailPath: string,
  ): Promise<string> {
    const thumbnailStream = await this.getVideoStream(thumbnailPath);

    const response = await this.youtube.thumbnails.set(
      {
        videoId,
        media: {
          body: thumbnailStream,
        },
      },
      { rootUrl: vendorUrl('youtube-data') },
    );

    return response.data.items?.[0]?.default?.url ?? '';
  }

  /**
   * Adds a video to a playlist
   */
  async addToPlaylist(videoId: string, playlistId: string): Promise<void> {
    await this.youtube.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
        },
      },
    });
  }

  /**
   * Gets the authenticated user's channel info
   */
  async getChannel(): Promise<YouTubeChannel> {
    const response = await this.youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel || !channel.id) {
      throw new Error('No channel found');
    }

    return {
      id: channel.id,
      title: channel.snippet?.title ?? '',
      thumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? '',
      subscriberCount:
        channel.statistics?.subscriberCount === undefined ||
        channel.statistics.subscriberCount === null
          ? null
          : parseInt(channel.statistics.subscriberCount, 10),
    };
  }

  /**
   * Current subscriber count for one specific channel (FILM-1607).
   *
   * Deliberately not `getChannel()`. That call is `mine: true` and returns
   * `items[0]`, but one Google account can own several channels — the OAuth
   * callback fetches all of them, brand channels included, and creates a
   * `platform_connections` row per selected channel. A per-connection capture
   * built on it would write the first channel's count under every one of that
   * account's connections, and since a sub-1,000 count is stored as an *exact*
   * anchor, the others' curves would be pinned to a level that is not theirs.
   *
   * `hidden` is distinguished from `unavailable` because the first is a
   * creator setting that will recur every night forever and must never alert,
   * while the second is an outage that must.
   */
  async getSubscriberCount(channelId: string): Promise<SubscriberCountResult> {
    const response = await this.youtube.channels.list({
      part: ['statistics'],
      id: [channelId],
    });

    const channel = response.data.items?.[0];

    if (!channel) {
      return { ok: false, reason: 'unavailable' };
    }

    if (channel.statistics?.hiddenSubscriberCount === true) {
      return { ok: false, reason: 'hidden' };
    }

    const raw = channel.statistics?.subscriberCount;

    if (raw === undefined || raw === null) {
      return { ok: false, reason: 'unavailable' };
    }

    const count = parseInt(raw, 10);

    return Number.isFinite(count)
      ? { ok: true, count }
      : { ok: false, reason: 'unavailable' };
  }

  /**
   * Gets the authenticated user's playlists
   */
  async getPlaylists(): Promise<YouTubePlaylist[]> {
    const response = await this.youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
      maxResults: 50,
    });

    return (response.data.items ?? []).map((playlist) => ({
      id: playlist.id ?? '',
      title: playlist.snippet?.title ?? '',
      itemCount: playlist.contentDetails?.itemCount ?? 0,
    }));
  }

  /**
   * Creates a new playlist
   */
  async createPlaylist(
    title: string,
    description: string,
    privacy: 'private' | 'unlisted' | 'public',
  ): Promise<YouTubePlaylist> {
    const response = await this.youtube.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description },
        status: { privacyStatus: privacy },
      },
    });

    return {
      id: response.data.id ?? '',
      title: response.data.snippet?.title ?? '',
      itemCount: 0,
    };
  }

  /**
   * Gets video categories for a region
   */
  async getCategories(regionCode = 'US'): Promise<YouTubeCategory[]> {
    const response = await this.youtube.videoCategories.list({
      part: ['snippet'],
      regionCode,
    });

    return (response.data.items ?? [])
      .filter((cat) => cat.snippet?.assignable)
      .map((cat) => ({
        id: cat.id ?? '',
        title: cat.snippet?.title ?? '',
      }));
  }

  /**
   * Deletes a video from YouTube
   * Note: This permanently deletes the video and cannot be undone
   */
  async deleteVideo(videoId: string): Promise<void> {
    await this.youtube.videos.delete({
      id: videoId,
    });
  }

  /**
   * Gets a readable stream for the video file
   */
  private async getVideoStream(path: string): Promise<Readable> {
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
      // Convert web stream to Node.js Readable
      return Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      );
    }
    return createReadStream(path);
  }

  /**
   * Gets the file size for progress tracking
   */
  private async getFileSize(path: string): Promise<number> {
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
}

/**
 * Creates a YouTube provider instance with the given access token
 */
export function createYouTubeProvider(accessToken: string): YouTubeProvider {
  return new YouTubeProvider(accessToken);
}
