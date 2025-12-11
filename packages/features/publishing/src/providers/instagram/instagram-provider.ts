import type {
  InstagramAccount,
  InstagramContainerStatus,
  InstagramLocation,
  InstagramUploadInput,
  InstagramUploadResult,
} from './types';
import { INSTAGRAM_CONSTRAINTS } from './types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Instagram Provider
 * Handles video uploads as Reels using the Instagram Content Publishing API
 */
export class InstagramProvider {
  constructor(
    private accessToken: string,
    private instagramAccountId: string,
  ) { }

  /**
   * Publishes a video as a Reel
   * Uses container-based upload: create → poll → publish
   */
  async uploadReel(
    input: InstagramUploadInput,
  ): Promise<InstagramUploadResult> {
    // Validate caption length
    if (input.caption.length > INSTAGRAM_CONSTRAINTS.maxCaptionLength) {
      throw new Error(
        `Caption exceeds maximum length of ${INSTAGRAM_CONSTRAINTS.maxCaptionLength} characters`,
      );
    }

    // 1. Create media container
    const container = await this.createMediaContainer(input);

    // 2. Poll until ready
    let status = await this.getContainerStatus(container.id);
    let attempts = 0;

    while (
      status.status === 'IN_PROGRESS' &&
      attempts < INSTAGRAM_CONSTRAINTS.maxPollingAttempts
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, INSTAGRAM_CONSTRAINTS.pollingIntervalMs),
      );
      status = await this.getContainerStatus(container.id);
      attempts++;
    }

    if (status.status === 'ERROR') {
      return {
        mediaId: '',
        containerId: container.id,
        status: 'ERROR',
        errorMessage: status.error || 'Instagram processing failed',
      };
    }

    if (status.status === 'IN_PROGRESS') {
      return {
        mediaId: '',
        containerId: container.id,
        status: 'IN_PROGRESS',
        errorMessage: 'Processing timeout - video may still be processing',
      };
    }

    // 3. Publish the container
    const mediaId = await this.publishContainer(container.id);

    // 4. Get permalink
    const media = await this.getMedia(mediaId);

    return {
      mediaId,
      containerId: container.id,
      status: 'FINISHED',
      permalink: media.permalink,
    };
  }

  /**
   * Creates a media container for Reels
   */
  private async createMediaContainer(
    input: InstagramUploadInput,
  ): Promise<{ id: string }> {
    const params = new URLSearchParams({
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: input.shareToFeed.toString(),
      access_token: this.accessToken,
    });

    if (input.coverUrl) {
      params.set('cover_url', input.coverUrl);
    }

    if (input.locationId) {
      params.set('location_id', input.locationId);
    }

    if (input.collaborators?.length) {
      params.set('collaborators', input.collaborators.join(','));
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}/media?${params}`,
      { method: 'POST' },
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Instagram container creation failed: ${data.error.message}`,
      );
    }

    return { id: data.id };
  }

  /**
   * Gets container status
   */
  private async getContainerStatus(
    containerId: string,
  ): Promise<InstagramContainerStatus> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${this.accessToken}`,
    );

    const data = await response.json();

    if (data.error) {
      return {
        status: 'ERROR',
        error: data.error.message,
      };
    }

    return {
      status: data.status_code as InstagramContainerStatus['status'],
      error: data.status,
    };
  }

  /**
   * Publishes a ready container
   */
  private async publishContainer(containerId: string): Promise<string> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: this.accessToken,
        }),
      },
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Instagram publish failed: ${data.error.message}`);
    }

    return data.id;
  }

  /**
   * Gets media details
   */
  private async getMedia(mediaId: string): Promise<{ permalink: string }> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${this.accessToken}`,
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get media details: ${data.error.message}`);
    }

    return { permalink: data.permalink };
  }

  /**
   * Gets connected Instagram account info
   */
  async getAccount(): Promise<InstagramAccount> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}?fields=username,name,profile_picture_url,followers_count&access_token=${this.accessToken}`,
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get account info: ${data.error.message}`);
    }

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      followersCount: data.followers_count,
    };
  }

  /**
   * Searches for locations (Facebook Places)
   */
  async searchLocations(query: string): Promise<InstagramLocation[]> {
    const response = await fetch(
      `${GRAPH_API_BASE}/pages/search?q=${encodeURIComponent(query)}&fields=id,name,location&access_token=${this.accessToken}`,
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Location search failed: ${data.error.message}`);
    }

    return (data.data || []).map((page: { id: string; name: string }) => ({
      id: page.id,
      name: page.name,
    }));
  }
}

/**
 * Creates an Instagram provider instance
 */
export function createInstagramProvider(
  accessToken: string,
  instagramAccountId: string,
): InstagramProvider {
  return new InstagramProvider(accessToken, instagramAccountId);
}
