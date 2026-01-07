import { createReadStream, promises as fsPromises } from 'fs';
import { Readable } from 'stream';

import type {
  TikTokUploadInit,
  TikTokUploadInput,
  TikTokUploadProgress,
  TikTokUploadResult,
  TikTokUser,
} from './types';
import { TIKTOK_CONSTRAINTS } from './types';

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * TikTok Provider
 * Handles video uploads using TikTok's Content Posting API with streaming chunked upload
 * 
 * Memory-optimized: Uses streaming to avoid loading entire video into memory.
 * This allows uploading large videos (up to 4GB) without running out of memory.
 */
export class TikTokProvider {
  constructor(private accessToken: string) { }

  /**
   * Uploads a video to TikTok using the Content Posting API
   * Uses streaming chunked upload for memory efficiency
   */
  async uploadVideo(
    input: TikTokUploadInput,
    onProgress?: TikTokUploadProgress,
  ): Promise<TikTokUploadResult> {
    // Validate caption length
    if (input.caption.length > TIKTOK_CONSTRAINTS.maxCaptionLength) {
      throw new Error(
        `Caption exceeds maximum length of ${TIKTOK_CONSTRAINTS.maxCaptionLength} characters`,
      );
    }

    // 1. Get video info
    const videoSize = await this.getFileSize(input.videoPath);

    if (videoSize > TIKTOK_CONSTRAINTS.maxFileSizeBytes) {
      throw new Error(
        `Video size exceeds maximum of ${TIKTOK_CONSTRAINTS.maxFileSizeBytes / (1024 * 1024 * 1024)}GB`,
      );
    }

    const chunkSize = TIKTOK_CONSTRAINTS.chunkSizeBytes;
    const totalChunks = Math.ceil(videoSize / chunkSize);

    // 2. Initialize upload
    const initResponse = await this.initUpload({
      source: 'FILE_UPLOAD',
      videoSize,
      chunkSize,
      totalChunkCount: totalChunks,
    });

    const { uploadId, uploadUrl } = initResponse;

    // 3. Upload chunks using streaming (memory-efficient)
    await this.uploadChunksStreaming(
      input.videoPath,
      uploadUrl,
      videoSize,
      chunkSize,
      onProgress,
    );

    // 4. Complete upload and create post
    const postResponse = await this.createPost(uploadId, input);

    return {
      publishId: postResponse.publishId,
      status: 'PROCESSING',
    };
  }

  /**
   * Uploads video chunks using streaming - reads and uploads one chunk at a time
   * Memory usage stays constant regardless of video size (only ~10MB per chunk)
   */
  private async uploadChunksStreaming(
    videoPath: string,
    uploadUrl: string,
    videoSize: number,
    chunkSize: number,
    onProgress?: TikTokUploadProgress,
  ): Promise<void> {
    let uploadedBytes = 0;

    if (videoPath.startsWith('http')) {
      // For remote URLs: stream and process chunks on-the-fly
      const response = await fetch(videoPath);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch video: ${response.status}`);
      }

      const reader = response.body.getReader();
      let buffer = new Uint8Array(0);

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          // Append new data to buffer
          const newBuffer = new Uint8Array(buffer.length + value.length);
          newBuffer.set(buffer);
          newBuffer.set(value, buffer.length);
          buffer = newBuffer;
        }

        // Process complete chunks from buffer
        while (buffer.length >= chunkSize || (done && buffer.length > 0)) {
          const currentChunkSize = Math.min(chunkSize, buffer.length);
          const chunk = buffer.slice(0, currentChunkSize);
          const startByte = uploadedBytes;
          const endByte = uploadedBytes + chunk.length - 1;

          await this.uploadChunk(uploadUrl, chunk, startByte, endByte, videoSize);

          uploadedBytes += chunk.length;
          const progress = Math.round((uploadedBytes / videoSize) * 100);
          onProgress?.(progress);

          // Remove processed chunk from buffer
          buffer = buffer.slice(currentChunkSize);

          // If done and buffer is empty, we're finished
          if (done && buffer.length === 0) break;
        }

        if (done) break;
      }
    } else {
      // For local files: use Node.js streams for efficient reading
      const stream = createReadStream(videoPath, { highWaterMark: chunkSize });

      for await (const data of stream) {
        const chunk = data instanceof Buffer ? new Uint8Array(data) : data;
        const startByte = uploadedBytes;
        const endByte = uploadedBytes + chunk.length - 1;

        await this.uploadChunk(uploadUrl, chunk, startByte, endByte, videoSize);

        uploadedBytes += chunk.length;
        const progress = Math.round((uploadedBytes / videoSize) * 100);
        onProgress?.(progress);
      }
    }
  }

  /**
   * Initializes the upload session
   */
  private async initUpload(params: {
    source: 'FILE_UPLOAD';
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
  }): Promise<TikTokUploadInit> {
    const response = await fetch(
      `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_info: {
            source: params.source,
            video_size: params.videoSize,
            chunk_size: params.chunkSize,
            total_chunk_count: params.totalChunkCount,
          },
        }),
      },
    );

    const data = await response.json();

    if (data.error?.code !== 'ok' && data.error?.code !== undefined) {
      throw new Error(
        `TikTok init failed: ${data.error?.message || 'Unknown error'}`,
      );
    }

    if (!data.data?.upload_id || !data.data?.upload_url) {
      throw new Error('TikTok init failed: Missing upload_id or upload_url');
    }

    return {
      uploadId: data.data.upload_id,
      uploadUrl: data.data.upload_url,
    };
  }

  /**
   * Uploads a single chunk using Content-Range header
   */
  private async uploadChunk(
    uploadUrl: string,
    chunk: Uint8Array,
    startByte: number,
    endByte: number,
    totalSize: number,
  ): Promise<void> {
    // Convert Uint8Array to Blob for fetch compatibility
    const blob = new Blob([chunk.buffer as ArrayBuffer], { type: 'video/mp4' });

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${startByte}-${endByte}/${totalSize}`,
        'Content-Length': String(chunk.length),
      },
      body: blob,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chunk upload failed: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Creates the post after upload is complete
   */
  private async createPost(
    uploadId: string,
    input: TikTokUploadInput,
  ): Promise<{ publishId: string }> {
    const postInfo: Record<string, unknown> = {
      title: input.caption,
      privacy_level: input.privacy,
      disable_duet: input.disableDuet,
      disable_stitch: input.disableStitch,
      disable_comment: input.disableComment,
    };

    if (input.videoCoverTimestampMs !== undefined) {
      postInfo.video_cover_timestamp_ms = input.videoCoverTimestampMs;
    }

    if (input.brandContentToggle !== undefined) {
      postInfo.brand_content_toggle = input.brandContentToggle;
    }

    if (input.brandOrganicToggle !== undefined) {
      postInfo.brand_organic_toggle = input.brandOrganicToggle;
    }

    const response = await fetch(
      `${TIKTOK_API_BASE}/post/publish/video/init/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: postInfo,
          source_info: {
            source: 'FILE_UPLOAD',
            video_upload_id: uploadId,
          },
        }),
      },
    );

    const data = await response.json();

    if (data.error?.code !== 'ok' && data.error?.code !== undefined) {
      throw new Error(
        `TikTok post failed: ${data.error?.message || 'Unknown error'}`,
      );
    }

    if (!data.data?.publish_id) {
      throw new Error('TikTok post failed: Missing publish_id');
    }

    return { publishId: data.data.publish_id };
  }

  /**
   * Checks the status of a published video
   */
  async getPublishStatus(publishId: string): Promise<TikTokUploadResult> {
    const response = await fetch(
      `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publish_id: publishId,
        }),
      },
    );

    const data = await response.json();

    const status = data.data?.status ?? 'PROCESSING';
    const result: TikTokUploadResult = {
      publishId,
      status: status as TikTokUploadResult['status'],
    };

    if (data.data?.publicaly_available_post_id) {
      // Post ID is available when complete
      result.videoUrl = `https://www.tiktok.com/@${data.data.creator_username}/video/${data.data.publicaly_available_post_id}`;
    }

    if (data.data?.fail_reason) {
      result.errorMessage = data.data.fail_reason;
    }

    return result;
  }

  /**
   * Gets user profile info
   */
  async getUserInfo(): Promise<TikTokUser> {
    const response = await fetch(
      `${TIKTOK_API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    const data = await response.json();

    if (data.error?.code !== 'ok' && data.error?.code !== undefined) {
      throw new Error(
        `Failed to get user info: ${data.error?.message || 'Unknown error'}`,
      );
    }

    const user = data.data?.user;
    if (!user) {
      throw new Error('Failed to get user info: No user data');
    }

    return {
      openId: user.open_id,
      unionId: user.union_id,
      avatarUrl: user.avatar_url,
      displayName: user.display_name,
      followerCount: user.follower_count ?? 0,
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
}

/**
 * Creates a TikTok provider instance with the given access token
 */
export function createTikTokProvider(accessToken: string): TikTokProvider {
  return new TikTokProvider(accessToken);
}
