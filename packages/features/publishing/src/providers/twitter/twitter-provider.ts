import { promises as fsPromises } from 'fs';

import type {
  TwitterMediaInit,
  TwitterUploadInput,
  TwitterUploadProgress,
  TwitterUploadResult,
  TwitterUser,
} from './types';
import { TWITTER_CONSTRAINTS } from './types';

const TWITTER_API_V2 = 'https://api.twitter.com/2';
const TWITTER_UPLOAD_API = 'https://upload.twitter.com/1.1/media/upload.json';

/**
 * Twitter/X Provider
 * Handles video uploads using Twitter's chunked media upload API
 * and tweet creation using the v2 API
 */
export class TwitterProvider {
  constructor(private accessToken: string) { }

  /**
   * Uploads a video to Twitter and creates a tweet
   * Uses chunked upload for video files
   */
  async uploadVideo(
    input: TwitterUploadInput,
    onProgress?: TwitterUploadProgress,
  ): Promise<TwitterUploadResult> {
    // Validate tweet length
    if (input.text.length > TWITTER_CONSTRAINTS.maxTweetLength) {
      throw new Error(
        `Tweet exceeds maximum length of ${TWITTER_CONSTRAINTS.maxTweetLength} characters`,
      );
    }

    // 1. Get video info
    const videoSize = await this.getFileSize(input.videoPath);

    if (videoSize > TWITTER_CONSTRAINTS.maxFileSizeBytes) {
      throw new Error(
        `Video size exceeds maximum of ${TWITTER_CONSTRAINTS.maxFileSizeBytes / (1024 * 1024)}MB`,
      );
    }

    // 2. Initialize upload
    const initResponse = await this.initUpload(videoSize);
    const { mediaId } = initResponse;

    // 3. Upload chunks
    const videoBuffer = await this.getVideoBuffer(input.videoPath);
    const chunkSize = TWITTER_CONSTRAINTS.chunkSizeBytes;
    const totalChunks = Math.ceil(videoSize / chunkSize);
    let uploadedBytes = 0;

    for (let segmentIndex = 0; segmentIndex < totalChunks; segmentIndex++) {
      const start = segmentIndex * chunkSize;
      const end = Math.min(start + chunkSize, videoSize);
      const chunk = videoBuffer.subarray(start, end);

      await this.uploadChunk(mediaId, segmentIndex, chunk);

      uploadedBytes += chunk.length;
      const progress = Math.round((uploadedBytes / videoSize) * 100);
      onProgress?.(progress);
    }

    // 4. Finalize upload
    await this.finalizeUpload(mediaId);

    // 5. Wait for processing
    await this.waitForProcessing(mediaId);

    // 6. Create tweet with media
    const tweetId = await this.createTweet(
      input.text,
      mediaId,
      input.replySettings,
    );

    return {
      tweetId,
      status: 'PUBLISHED',
      tweetUrl: `https://twitter.com/i/status/${tweetId}`,
    };
  }

  /**
   * Initializes the upload session using INIT command
   */
  private async initUpload(totalBytes: number): Promise<TwitterMediaInit> {
    const params = new URLSearchParams({
      command: 'INIT',
      total_bytes: String(totalBytes),
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    });

    const response = await fetch(`${TWITTER_UPLOAD_API}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Twitter upload init failed: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.media_id_string) {
      throw new Error('Twitter init failed: Missing media_id');
    }

    return {
      mediaId: data.media_id_string,
    };
  }

  /**
   * Uploads a single chunk using APPEND command
   */
  private async uploadChunk(
    mediaId: string,
    segmentIndex: number,
    chunk: Uint8Array,
  ): Promise<void> {
    // Create form data for chunk upload
    const formData = new FormData();
    formData.append('command', 'APPEND');
    formData.append('media_id', mediaId);
    formData.append('segment_index', String(segmentIndex));
    // Slice the underlying buffer to get only this chunk's bytes
    // subarray() creates a view with an offset, so chunk.buffer would include
    // bytes outside the chunk - we must slice to get the correct range
    const chunkBuffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    ) as ArrayBuffer;
    formData.append('media', new Blob([chunkBuffer], { type: 'video/mp4' }));

    const response = await fetch(TWITTER_UPLOAD_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Twitter chunk upload failed: ${response.status} - ${errorText}`,
      );
    }
  }

  /**
   * Finalizes the upload using FINALIZE command
   */
  private async finalizeUpload(mediaId: string): Promise<void> {
    const params = new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    });

    const response = await fetch(`${TWITTER_UPLOAD_API}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Twitter finalize failed: ${response.status} - ${errorText}`,
      );
    }
  }

  /**
   * Waits for video processing to complete using STATUS command
   * Uses elapsed time for timeout to ensure predictable behavior regardless
   * of Twitter's check_after_secs values
   */
  private async waitForProcessing(mediaId: string): Promise<void> {
    const maxWaitTimeMs = 5 * 60 * 1000; // 5 minutes max
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTimeMs) {
      const params = new URLSearchParams({
        command: 'STATUS',
        media_id: mediaId,
      });

      const response = await fetch(`${TWITTER_UPLOAD_API}?${params}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Twitter status check failed: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json();
      const processingInfo = data.processing_info;

      if (!processingInfo) {
        // No processing_info means processing is complete
        return;
      }

      if (processingInfo.state === 'succeeded') {
        return;
      }

      if (processingInfo.state === 'failed') {
        throw new Error(
          `Video processing failed: ${processingInfo.error?.message || 'Unknown error'}`,
        );
      }

      // Wait for the check_after_secs or default to 5 seconds
      const waitTime = (processingInfo.check_after_secs || 5) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    throw new Error('Video processing timeout after 5 minutes');
  }

  /**
   * Creates a tweet with the uploaded media
   */
  private async createTweet(
    text: string,
    mediaId: string,
    replySettings?: TwitterUploadInput['replySettings'],
  ): Promise<string> {
    const body: Record<string, unknown> = {
      text,
      media: {
        media_ids: [mediaId],
      },
    };

    if (replySettings) {
      body.reply_settings = replySettings;
    }

    const response = await fetch(`${TWITTER_API_V2}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Tweet creation failed: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.data?.id) {
      throw new Error('Tweet creation failed: Missing tweet ID');
    }

    return data.data.id;
  }

  /**
   * Gets user profile info
   */
  async getUserInfo(): Promise<TwitterUser> {
    const response = await fetch(
      `${TWITTER_API_V2}/users/me?user.fields=profile_image_url`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get user info: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    const user = data.data;

    if (!user) {
      throw new Error('Failed to get user info: No user data');
    }

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      profileImageUrl: user.profile_image_url ?? '',
    };
  }

  /**
   * Gets the file size for validation and chunking
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

  /**
   * Gets the video file as a buffer for chunked upload
   */
  private async getVideoBuffer(path: string): Promise<Uint8Array> {
    if (path.startsWith('http')) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch video: ${response.status} ${response.statusText}`,
        );
      }
      if (!response.body) {
        throw new Error('Failed to fetch video');
      }
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }

    const buffer = await fsPromises.readFile(path);
    return new Uint8Array(buffer);
  }
}

/**
 * Creates a Twitter provider instance with the given access token
 */
export function createTwitterProvider(accessToken: string): TwitterProvider {
  return new TwitterProvider(accessToken);
}
