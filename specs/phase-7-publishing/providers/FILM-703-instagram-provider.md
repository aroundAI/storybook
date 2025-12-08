# FILM-703: Instagram Provider

## Metadata
- **Status:** DONE
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-707 (Meta OAuth)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

Instagram supports Reels (short-form video up to 15 minutes) through the Instagram Content Publishing API. Videos must be hosted at a publicly accessible URL before publishing.

---

## Specification

### Requirements

1. **Reels Upload**: Publish videos as Reels
2. **Caption**: Set caption with hashtags and mentions
3. **Cover Image**: Custom thumbnail selection
4. **Share to Feed**: Option to share Reel to feed
5. **Container Status**: Poll for publishing completion

### Provider Interface

```typescript
// packages/features/publishing/src/providers/instagram/types.ts

export interface InstagramUploadInput {
  videoUrl: string;           // Must be publicly accessible
  caption: string;            // Max 2200 chars
  coverUrl?: string;          // Custom cover image
  shareToFeed: boolean;
  locationId?: string;        // Facebook Place ID
  collaborators?: string[];   // User IDs to tag
}

export interface InstagramUploadResult {
  mediaId: string;
  containerId: string;
  status: 'IN_PROGRESS' | 'FINISHED' | 'ERROR';
  permalink?: string;
}

export interface InstagramAccount {
  id: string;
  username: string;
  name: string;
  profilePictureUrl: string;
  followersCount: number;
}
```

### Provider Implementation

```typescript
// packages/features/publishing/src/providers/instagram/instagram-provider.ts

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

export class InstagramProvider {
  constructor(
    private accessToken: string,
    private instagramAccountId: string
  ) {}

  /**
   * Publishes a video as a Reel
   */
  async uploadReel(
    input: InstagramUploadInput
  ): Promise<InstagramUploadResult> {
    // 1. Create media container
    const container = await this.createMediaContainer(input);

    // 2. Poll until ready
    let status = await this.getContainerStatus(container.id);
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5s intervals

    while (status.status === 'IN_PROGRESS' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      status = await this.getContainerStatus(container.id);
      attempts++;
    }

    if (status.status === 'ERROR') {
      throw new Error(`Instagram processing failed: ${status.error}`);
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
    input: InstagramUploadInput
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
      { method: 'POST' }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Instagram container creation failed: ${data.error.message}`);
    }

    return { id: data.id };
  }

  /**
   * Gets container status
   */
  private async getContainerStatus(
    containerId: string
  ): Promise<{ status: string; error?: string }> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${containerId}?fields=status_code,status&access_token=${this.accessToken}`
    );

    const data = await response.json();

    return {
      status: data.status_code,
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
      }
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
  private async getMedia(
    mediaId: string
  ): Promise<{ permalink: string }> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${this.accessToken}`
    );

    const data = await response.json();
    return { permalink: data.permalink };
  }

  /**
   * Gets connected Instagram account info
   */
  async getAccount(): Promise<InstagramAccount> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}?fields=username,name,profile_picture_url,followers_count&access_token=${this.accessToken}`
    );

    const data = await response.json();

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      followersCount: data.followers_count,
    };
  }

  /**
   * Searches for locations
   */
  async searchLocations(query: string): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch(
      `${GRAPH_API_BASE}/pages/search?q=${encodeURIComponent(query)}&fields=id,name,location&access_token=${this.accessToken}`
    );

    const data = await response.json();
    return data.data.map((page: any) => ({
      id: page.id,
      name: page.name,
    }));
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/providers/instagram/instagram-provider.ts` |
| CREATE | `packages/features/publishing/src/providers/instagram/types.ts` |
| CREATE | `packages/features/publishing/src/providers/instagram/index.ts` |

---

## Acceptance Criteria

- [ ] Reels upload and publish successfully
- [ ] Caption with hashtags works
- [ ] Custom cover image can be set
- [ ] Share to feed option works
- [ ] Location tagging works
- [ ] Container status polling works
- [ ] Account info can be retrieved
- [ ] Permalink is returned after publish

---

## Test Plan

### Unit Tests
- [ ] Test caption length validation
- [ ] Test container status mapping

### Integration Tests
- [ ] Test full upload flow with mocked API
- [ ] Test status polling loop

---

## Error Handling

| Error | Handling |
|-------|----------|
| `EXPIRED` | Token refresh needed |
| `PROCESSING_FAILURE` | Video processing failed |
| `INVALID_VIDEO_DURATION` | Video too long/short |
| `INVALID_ASPECT_RATIO` | Not 9:16 |

---

## Constraints

- Video must be hosted at public URL (not local file)
- Reels: 0.5s - 15min duration
- Aspect ratio: 9:16 recommended
- Caption: Max 2200 characters
- Requires Instagram Business/Creator account

---

## Open Questions

- [ ] Should we support carousel posts? (post-MVP)
- [ ] Should we support Stories? (post-MVP)
