import { promises as fsPromises } from 'fs';

import type {
  LinkedInOrganization,
  LinkedInPostMetrics,
  LinkedInUploadInit,
  LinkedInUploadInput,
  LinkedInUploadProgress,
  LinkedInUploadResult,
  LinkedInUser,
  LinkedInVideoStatus,
} from './types';
import { LINKEDIN_CONSTRAINTS } from './types';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_REST_VERSION = '202401';

/**
 * LinkedIn Provider
 * Handles video uploads and post management using LinkedIn's Marketing API
 */
export class LinkedInProvider {
  constructor(private accessToken: string) {}

  /**
   * Uploads a video to LinkedIn and creates a post
   */
  async uploadVideo(
    input: LinkedInUploadInput,
    onProgress?: LinkedInUploadProgress,
  ): Promise<LinkedInUploadResult> {
    // Validate post text length
    if (input.text.length > LINKEDIN_CONSTRAINTS.post.maxLength) {
      throw new Error(
        `Post text exceeds maximum length of ${LINKEDIN_CONSTRAINTS.post.maxLength} characters`,
      );
    }

    // 1. Get video file size
    const videoSize = await this.getFileSize(input.videoPath);

    const maxSize = input.isCompanyPage
      ? LINKEDIN_CONSTRAINTS.video.company.maxSize
      : LINKEDIN_CONSTRAINTS.video.personal.maxSize;

    if (videoSize > maxSize) {
      throw new Error(
        `Video size exceeds maximum of ${maxSize / (1024 * 1024 * 1024)}GB`,
      );
    }

    // 2. Initialize upload
    const uploadInit = await this.initializeUpload(input.authorUrn, videoSize);

    // 3. Upload video binary
    await this.uploadVideoData(
      input.videoPath,
      uploadInit.uploadUrl,
      videoSize,
      onProgress,
    );

    // 4. Finalize upload
    await this.finalizeUpload(uploadInit.videoUrn);

    // 5. Wait for video processing
    await this.waitForProcessing(uploadInit.videoUrn);

    // 6. Create post with video
    const postUrn = await this.createPost({
      text: input.text,
      videoUrn: uploadInit.videoUrn,
      authorUrn: input.authorUrn,
      visibility: input.visibility,
    });

    return {
      postUrn,
      status: 'AVAILABLE',
      postUrl: `https://www.linkedin.com/feed/update/${postUrn}`,
    };
  }

  /**
   * Initializes a video upload session
   */
  private async initializeUpload(
    ownerUrn: string,
    fileSizeBytes: number,
  ): Promise<LinkedInUploadInit> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/videos?action=initializeUpload`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: ownerUrn,
            fileSizeBytes,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn upload init failed: ${error}`);
    }

    const data = await response.json();

    if (!data.value?.uploadInstructions?.[0]?.uploadUrl || !data.value?.video) {
      throw new Error(
        'LinkedIn upload init failed: Missing uploadUrl or video URN',
      );
    }

    return {
      uploadUrl: data.value.uploadInstructions[0].uploadUrl,
      videoUrn: data.value.video,
    };
  }

  /**
   * Uploads the video binary data to LinkedIn
   */
  private async uploadVideoData(
    videoPath: string,
    uploadUrl: string,
    _totalSize: number,
    onProgress?: LinkedInUploadProgress,
  ): Promise<void> {
    const videoBuffer = await this.getVideoBuffer(videoPath);

    // Convert Uint8Array to Blob for fetch compatibility
    const blob = new Blob([videoBuffer.buffer as ArrayBuffer], {
      type: 'video/mp4',
    });

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn video upload failed: ${error}`);
    }

    // Report 100% progress after upload
    onProgress?.(100);
  }

  /**
   * Finalizes the video upload
   */
  private async finalizeUpload(videoUrn: string): Promise<void> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/videos?action=finalizeUpload`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: videoUrn,
            uploadToken: '',
            uploadedPartIds: [],
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn upload finalize failed: ${error}`);
    }
  }

  /**
   * Creates a post with the uploaded video
   */
  private async createPost(params: {
    text: string;
    videoUrn: string;
    authorUrn: string;
    visibility: 'PUBLIC' | 'CONNECTIONS';
  }): Promise<string> {
    const response = await fetch(`${LINKEDIN_API_BASE}/posts`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        author: params.authorUrn,
        commentary: params.text,
        visibility: params.visibility,
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            title: params.text.substring(0, 100),
            id: params.videoUrn,
          },
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn post creation failed: ${error}`);
    }

    const data = await response.json();

    if (!data.id) {
      throw new Error('LinkedIn post creation failed: Missing post ID');
    }

    return data.id;
  }

  /**
   * Gets the status of a video
   */
  async getVideoStatus(videoUrn: string): Promise<LinkedInVideoStatus> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/videos/${encodeURIComponent(videoUrn)}`,
      {
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get video status: ${error}`);
    }

    const data = await response.json();

    return {
      videoUrn,
      status: data.status as LinkedInVideoStatus['status'],
      failedReason: data.failedReason,
    };
  }

  /**
   * Gets metrics for a post
   */
  async getPostMetrics(postUrn: string): Promise<LinkedInPostMetrics> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/socialActions/${encodeURIComponent(postUrn)}`,
      {
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      // Return zeros if metrics not available
      return { impressions: 0, likes: 0, comments: 0, shares: 0 };
    }

    const data = await response.json();
    const stats = data.totalShareStatistics || {};

    return {
      impressions: stats.impressionCount || 0,
      likes: stats.likeCount || 0,
      comments: stats.commentCount || 0,
      shares: stats.shareCount || 0,
    };
  }

  /**
   * Deletes a post
   */
  async deletePost(postUrn: string): Promise<void> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/posts/${encodeURIComponent(postUrn)}`,
      {
        method: 'DELETE',
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete post: ${error}`);
    }
  }

  /**
   * Gets the authenticated user's profile using OpenID Connect
   */
  async getUserInfo(): Promise<LinkedInUser> {
    const response = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const data = await response.json();

    return {
      sub: data.sub,
      name: data.name,
      givenName: data.given_name,
      familyName: data.family_name,
      picture: data.picture,
      email: data.email,
    };
  }

  /**
   * Gets organizations (company pages) the user can manage
   */
  async getOrganizations(): Promise<LinkedInOrganization[]> {
    const response = await fetch(
      `${LINKEDIN_API_BASE}/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
      {
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      // Return empty array if organizations not accessible
      return [];
    }

    const data = await response.json();
    const orgUrns =
      data.elements?.map(
        (el: { organizationalTarget: string }) => el.organizationalTarget,
      ) || [];

    if (orgUrns.length === 0) {
      return [];
    }

    // Fetch organization details
    const orgs: LinkedInOrganization[] = [];
    for (const urn of orgUrns) {
      try {
        const orgResponse = await fetch(
          `${LINKEDIN_API_BASE}/organizations/${encodeURIComponent(urn)}`,
          {
            headers: this.getHeaders(),
          },
        );

        if (orgResponse.ok) {
          const orgData = await orgResponse.json();
          orgs.push({
            id: urn,
            name: orgData.localizedName || orgData.name,
            logoUrl: orgData.logoV2?.original,
          });
        }
      } catch {
        // Skip organizations we can't fetch
      }
    }

    return orgs;
  }

  /**
   * Waits for video processing to complete
   */
  private async waitForProcessing(videoUrn: string): Promise<void> {
    const maxAttempts = 60; // 5 minutes max (5s intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.getVideoStatus(videoUrn);

      if (status.status === 'AVAILABLE') {
        return;
      }

      if (status.status === 'FAILED') {
        throw new Error(
          `Video processing failed: ${status.failedReason || 'Unknown error'}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Video processing timeout');
  }

  /**
   * Gets default headers for LinkedIn API requests
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_REST_VERSION,
    };
  }

  /**
   * Gets the file size for validation
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
   * Gets the video file as a buffer
   */
  private async getVideoBuffer(path: string): Promise<Uint8Array> {
    if (path.startsWith('http')) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch video: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }

    const buffer = await fsPromises.readFile(path);
    return new Uint8Array(buffer);
  }
}

/**
 * Creates a LinkedIn provider instance with the given access token
 */
export function createLinkedInProvider(accessToken: string): LinkedInProvider {
  return new LinkedInProvider(accessToken);
}
