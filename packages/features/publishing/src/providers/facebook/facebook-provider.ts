import { promises as fsPromises } from 'fs';

import type {
  FacebookPage,
  FacebookResumableSession,
  FacebookUploadInput,
  FacebookUploadProgress,
  FacebookUploadResult,
} from './types';
import { FACEBOOK_CONSTRAINTS, FACEBOOK_GRAPH_API_BASE } from './types';

/**
 * Facebook Provider
 * Handles video uploads to Facebook Pages using the Graph API
 * Supports both simple uploads (< 1GB) and resumable uploads (> 1GB)
 */
export class FacebookProvider {
  constructor(
    private accessToken: string,
    private pageId: string,
  ) {}

  /**
   * Uploads a video to Facebook Page
   * Automatically selects simple or resumable upload based on file size
   * For Reels, uses the dedicated Reels API with 3-phase upload
   */
  async uploadVideo(
    input: FacebookUploadInput,
    onProgress?: FacebookUploadProgress,
  ): Promise<FacebookUploadResult> {
    // Reels use a different API endpoint with required 3-phase upload
    if (input.isReel) {
      return this.uploadReel(input, onProgress);
    }

    const fileSize = await this.getFileSize(input.videoPath);

    if (fileSize > FACEBOOK_CONSTRAINTS.maxFileSizeBytes) {
      throw new Error(
        `Video size exceeds maximum of ${FACEBOOK_CONSTRAINTS.maxFileSizeBytes / (1024 * 1024 * 1024)}GB`,
      );
    }

    // Use resumable upload for files > 1GB
    if (fileSize > FACEBOOK_CONSTRAINTS.resumableThresholdBytes) {
      return this.resumableUpload(input, fileSize, onProgress);
    }

    // Simple upload for smaller files
    return this.simpleUpload(input, onProgress);
  }

  /**
   * Uploads a Reel to Facebook Page using the 2-phase protocol
   * Phase 1: Initialize upload session (start) - returns upload_url and video_id
   * Phase 2: Upload video to upload_url, then Finish/Publish
   */
  private async uploadReel(
    input: FacebookUploadInput,
    onProgress?: FacebookUploadProgress,
  ): Promise<FacebookUploadResult> {
    const endpoint = `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/video_reels`;

    // Phase 1: Initialize upload session
    const startResponse = await fetch(
      `${endpoint}?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
        }),
      },
    );

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      throw new Error(
        `Facebook Reel start failed: ${startResponse.status} ${startResponse.statusText} - ${errorText}`,
      );
    }

    const startData = await startResponse.json();
    if (startData.error) {
      throw new Error(`Facebook Reel start failed: ${startData.error.message}`);
    }

    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;

    onProgress?.(10);

    // Phase 2: Upload video file to the upload_url using file_url header
    // Facebook fetches the video from the provided URL
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${this.accessToken}`,
        file_url: input.videoPath,
      },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(
        `Facebook Reel upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`,
      );
    }

    // Check upload response for errors
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (uploadData.error) {
      throw new Error(
        `Facebook Reel upload failed: ${uploadData.error.message}`,
      );
    }

    onProgress?.(70);

    // Phase 3: Publish the Reel (finish)
    const finishResponse = await fetch(
      `${endpoint}?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'finish',
          video_id: videoId,
          title: input.title,
          description: input.description,
          video_state: 'PUBLISHED',
        }),
      },
    );

    if (!finishResponse.ok) {
      const errorText = await finishResponse.text();
      throw new Error(
        `Facebook Reel finish failed: ${finishResponse.status} ${finishResponse.statusText} - ${errorText}`,
      );
    }

    const finishData = await finishResponse.json();
    if (finishData.error) {
      throw new Error(
        `Facebook Reel finish failed: ${finishData.error.message}`,
      );
    }

    onProgress?.(100);

    return {
      videoId,
      status: 'processing',
    };
  }

  /**
   * Simple upload for videos < 1GB
   * Uses a single POST request with FormData
   */
  private async simpleUpload(
    input: FacebookUploadInput,
    onProgress?: FacebookUploadProgress,
  ): Promise<FacebookUploadResult> {
    const formData = new FormData();

    // Add video file or URL
    if (input.videoPath.startsWith('http')) {
      formData.append('file_url', input.videoPath);
    } else {
      const videoBuffer = await fsPromises.readFile(input.videoPath);
      // Convert Buffer to Uint8Array for Blob compatibility
      const uint8Array = new Uint8Array(videoBuffer);
      formData.append('source', new Blob([uint8Array]), 'video.mp4');
    }

    // Add metadata
    formData.append('title', input.title);
    formData.append('description', input.description);
    formData.append('published', input.published.toString());

    if (input.scheduledPublishTime) {
      formData.append(
        'scheduled_publish_time',
        Math.floor(input.scheduledPublishTime.getTime() / 1000).toString(),
      );
    }

    // Add thumbnail if provided (URL only for simple upload)
    if (input.thumbnailPath?.startsWith('http')) {
      formData.append('thumb', input.thumbnailPath);
    }

    // Add targeting if provided
    if (input.targeting) {
      const targetingSpec: Record<string, unknown> = {};
      if (input.targeting.ageMin) {
        targetingSpec.age_min = input.targeting.ageMin;
      }
      if (input.targeting.ageMax) {
        targetingSpec.age_max = input.targeting.ageMax;
      }
      if (input.targeting.geoLocations?.length) {
        targetingSpec.geo_locations = {
          countries: input.targeting.geoLocations,
        };
      }
      if (Object.keys(targetingSpec).length > 0) {
        formData.append('targeting', JSON.stringify(targetingSpec));
      }
    }

    // Select endpoint based on content type
    const endpoint = input.isReel
      ? `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/video_reels`
      : `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/videos`;

    const response = await fetch(
      `${endpoint}?access_token=${this.accessToken}`,
      {
        method: 'POST',
        body: formData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook upload failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Facebook upload failed: ${data.error.message}`);
    }

    onProgress?.(100);

    return {
      videoId: data.id,
      status: input.published ? 'processing' : 'ready',
    };
  }

  /**
   * Resumable upload for large files (> 1GB)
   * Uses Facebook's 3-phase resumable upload protocol
   */
  private async resumableUpload(
    input: FacebookUploadInput,
    fileSize: number,
    onProgress?: FacebookUploadProgress,
  ): Promise<FacebookUploadResult> {
    // Phase 1: Start upload session
    const session = await this.startResumableSession(fileSize);

    // Phase 2: Upload chunks
    let currentOffset = session.startOffset;
    const chunkSize = session.endOffset - session.startOffset;

    while (currentOffset < fileSize) {
      const chunk = await this.readChunk(
        input.videoPath,
        currentOffset,
        Math.min(chunkSize, fileSize - currentOffset),
      );

      const transferResult = await this.transferChunk(
        session.uploadSessionId,
        chunk,
        currentOffset,
      );

      // Validate that offset actually advances to prevent infinite loop
      if (transferResult.startOffset <= currentOffset) {
        throw new Error(
          `Facebook upload stalled: offset did not advance (current: ${currentOffset}, returned: ${transferResult.startOffset})`,
        );
      }
      currentOffset = transferResult.startOffset;

      // Report progress
      const progress = Math.round((currentOffset / fileSize) * 100);
      onProgress?.(Math.min(progress, 99)); // Reserve 100% for finish
    }

    // Phase 3: Finish upload
    const result = await this.finishResumableUpload(
      session.uploadSessionId,
      session.videoId,
      input,
    );

    onProgress?.(100);

    return result;
  }

  /**
   * Phase 1: Start resumable upload session
   */
  private async startResumableSession(
    fileSize: number,
  ): Promise<FacebookResumableSession> {
    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
          file_size: fileSize,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook resumable start failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Facebook resumable start failed: ${data.error.message}`);
    }

    return {
      uploadSessionId: data.upload_session_id,
      videoId: data.video_id,
      startOffset: data.start_offset,
      endOffset: data.end_offset,
    };
  }

  /**
   * Phase 2: Transfer a chunk
   */
  private async transferChunk(
    uploadSessionId: string,
    chunk: Buffer,
    startOffset: number,
  ): Promise<{ startOffset: number; endOffset: number }> {
    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'transfer',
          upload_session_id: uploadSessionId,
          start_offset: startOffset,
          video_file_chunk: chunk.toString('base64'),
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook chunk transfer failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Facebook chunk transfer failed: ${data.error.message}`);
    }

    return {
      startOffset: data.start_offset,
      endOffset: data.end_offset,
    };
  }

  /**
   * Phase 3: Finish resumable upload
   */
  private async finishResumableUpload(
    uploadSessionId: string,
    videoId: string,
    input: FacebookUploadInput,
  ): Promise<FacebookUploadResult> {
    const finishData: Record<string, unknown> = {
      upload_phase: 'finish',
      upload_session_id: uploadSessionId,
      title: input.title,
      description: input.description,
      published: input.published,
    };

    if (input.scheduledPublishTime) {
      finishData.scheduled_publish_time = Math.floor(
        input.scheduledPublishTime.getTime() / 1000,
      );
    }

    // Add thumbnail if provided
    if (input.thumbnailPath?.startsWith('http')) {
      finishData.thumb = input.thumbnailPath;
    }

    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finishData),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook resumable finish failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Facebook resumable finish failed: ${data.error.message}`,
      );
    }

    return {
      videoId,
      status: input.published ? 'processing' : 'ready',
    };
  }

  /**
   * Gets the processing status of a video
   */
  async getVideoStatus(videoId: string): Promise<FacebookUploadResult> {
    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${videoId}?fields=status,permalink_url&access_token=${this.accessToken}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook status check failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Facebook status check failed: ${data.error.message}`);
    }

    return {
      videoId,
      status: this.mapVideoStatus(data.status?.video_status),
      // Ensure full URL (Facebook sometimes returns relative paths like /reel/123)
      videoUrl: data.permalink_url?.startsWith('http')
        ? data.permalink_url
        : data.permalink_url
          ? `https://www.facebook.com${data.permalink_url}`
          : undefined,
    };
  }

  /**
   * Gets the list of Pages the user manages
   * Note: This uses the user access token, not page access token
   */
  async getPages(userAccessToken: string): Promise<FacebookPage[]> {
    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/me/accounts?fields=id,name,picture,fan_count,access_token&access_token=${userAccessToken}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook pages fetch failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Facebook pages fetch failed: ${data.error.message}`);
    }

    return (data.data ?? []).map((page: Record<string, unknown>) => ({
      id: page.id as string,
      name: page.name as string,
      pictureUrl:
        (page.picture as { data?: { url?: string } })?.data?.url ?? '',
      fanCount: (page.fan_count as number) ?? 0,
      accessToken: page.access_token as string,
    }));
  }

  /**
   * Maps Facebook video status to our status type
   */
  private mapVideoStatus(
    status: string | undefined,
  ): FacebookUploadResult['status'] {
    switch (status) {
      case 'processing':
        return 'processing';
      case 'ready':
        return 'ready';
      case 'complete':
      case 'published':
        return 'published';
      default:
        return 'error';
    }
  }

  /**
   * Deletes a video from Facebook
   * Note: This permanently deletes the video and cannot be undone
   */
  async deleteVideo(videoId: string): Promise<void> {
    const response = await fetch(
      `${FACEBOOK_GRAPH_API_BASE}/${videoId}?access_token=${this.accessToken}`,
      { method: 'DELETE' },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook delete failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Facebook delete failed: ${data.error.message}`);
    }
  }

  /**
   * Gets the file size for upload strategy selection
   */
  private async getFileSize(path: string): Promise<number> {
    if (path.startsWith('http')) {
      // Try HEAD request first
      const headResponse = await fetch(path, { method: 'HEAD' });
      if (headResponse.ok) {
        const contentLength = headResponse.headers.get('content-length');
        if (contentLength) {
          return parseInt(contentLength, 10);
        }
      }

      // Fallback: Fetch the file to determine size (for local storage or servers without Content-Length)
      const getResponse = await fetch(path);
      if (!getResponse.ok) {
        throw new Error(
          `Failed to get file: ${getResponse.status} ${getResponse.statusText}`,
        );
      }

      // Check Content-Length from GET response
      const getContentLength = getResponse.headers.get('content-length');
      if (getContentLength) {
        return parseInt(getContentLength, 10);
      }

      // Last resort: download and measure (expensive but works)
      const buffer = await getResponse.arrayBuffer();
      return buffer.byteLength;
    }
    const stats = await fsPromises.stat(path);
    return stats.size;
  }

  /**
   * Reads a chunk of the file for resumable upload
   */
  private async readChunk(
    path: string,
    start: number,
    size: number,
  ): Promise<Buffer> {
    if (path.startsWith('http')) {
      const response = await fetch(path, {
        headers: {
          Range: `bytes=${start}-${start + size - 1}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to read chunk: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    const handle = await fsPromises.open(path, 'r');
    try {
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, start);
      return buffer;
    } finally {
      await handle.close();
    }
  }
}

/**
 * Creates a Facebook provider instance with the given credentials
 */
export function createFacebookProvider(
  accessToken: string,
  pageId: string,
): FacebookProvider {
  return new FacebookProvider(accessToken, pageId);
}
