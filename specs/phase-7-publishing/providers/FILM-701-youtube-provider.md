---
spec_id: FILM-701
status: ✅ DONE
audited: 2026-09-23
---

# FILM-701: YouTube Provider

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** L (1-3 days)
- **Dependencies:** FILM-705 (YouTube OAuth), FILM-CC-03 (OAuth Token Refresh)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

YouTube is a primary distribution platform for long-form video content. This provider handles video uploads, metadata management, and playlist integration using the YouTube Data API v3.

---

## Specification

### Requirements

1. **Video Upload**: Upload videos with resumable upload support
2. **Metadata**: Set title, description, tags, category, privacy
3. **Thumbnails**: Upload custom thumbnails
4. **Playlists**: Add to existing playlists or create new ones
5. **Scheduling**: Schedule publish time
6. **Progress Tracking**: Report upload progress

### Provider Interface

```typescript
// packages/features/publishing/src/providers/youtube/types.ts

export interface YouTubeUploadInput {
  videoPath: string;          // Local file path or URL
  title: string;
  description: string;
  tags: string[];
  categoryId: string;         // YouTube category ID
  privacy: 'private' | 'unlisted' | 'public';
  publishAt?: Date;           // For scheduled publishing
  thumbnailPath?: string;
  playlistIds?: string[];
  madeForKids: boolean;
  defaultLanguage?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
  status: 'uploaded' | 'processing' | 'published';
  thumbnailUrl?: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  thumbnailUrl: string;
  subscriberCount: number;
}

export interface YouTubePlaylist {
  id: string;
  title: string;
  itemCount: number;
}
```

### Provider Implementation

```typescript
// packages/features/publishing/src/providers/youtube/youtube-provider.ts

import { google } from 'googleapis';
import { Readable } from 'stream';

export class YouTubeProvider {
  private youtube;

  constructor(private accessToken: string) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    this.youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Uploads a video to YouTube with resumable upload
   */
  async uploadVideo(
    input: YouTubeUploadInput,
    onProgress?: (progress: number) => void
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
        publishAt: input.publishAt?.toISOString(),
        madeForKids: input.madeForKids,
        selfDeclaredMadeForKids: input.madeForKids,
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
        onUploadProgress: (evt) => {
          const progress = Math.round((evt.bytesRead / fileSize) * 100);
          onProgress?.(progress);
        },
      }
    );

    const videoId = response.data.id!;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // 4. Upload thumbnail if provided
    if (input.thumbnailPath) {
      await this.uploadThumbnail(videoId, input.thumbnailPath);
    }

    // 5. Add to playlists
    if (input.playlistIds?.length) {
      await Promise.all(
        input.playlistIds.map(playlistId =>
          this.addToPlaylist(videoId, playlistId)
        )
      );
    }

    return {
      videoId,
      videoUrl,
      status: input.publishAt ? 'uploaded' : 'published',
    };
  }

  /**
   * Uploads a custom thumbnail
   */
  async uploadThumbnail(videoId: string, thumbnailPath: string): Promise<string> {
    const thumbnailStream = await this.getVideoStream(thumbnailPath);

    const response = await this.youtube.thumbnails.set({
      videoId,
      media: {
        body: thumbnailStream,
      },
    });

    return response.data.items?.[0]?.default?.url ?? '';
  }

  /**
   * Adds video to a playlist
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
   * Gets user's channel info
   */
  async getChannel(): Promise<YouTubeChannel> {
    const response = await this.youtube.channels.list({
      part: ['snippet', 'statistics'],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) throw new Error('No channel found');

    return {
      id: channel.id!,
      title: channel.snippet!.title!,
      thumbnailUrl: channel.snippet!.thumbnails?.default?.url ?? '',
      subscriberCount: parseInt(channel.statistics!.subscriberCount ?? '0'),
    };
  }

  /**
   * Gets user's playlists
   */
  async getPlaylists(): Promise<YouTubePlaylist[]> {
    const response = await this.youtube.playlists.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
      maxResults: 50,
    });

    return (response.data.items ?? []).map(playlist => ({
      id: playlist.id!,
      title: playlist.snippet!.title!,
      itemCount: playlist.contentDetails!.itemCount ?? 0,
    }));
  }

  /**
   * Creates a new playlist
   */
  async createPlaylist(
    title: string,
    description: string,
    privacy: 'private' | 'unlisted' | 'public'
  ): Promise<YouTubePlaylist> {
    const response = await this.youtube.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description },
        status: { privacyStatus: privacy },
      },
    });

    return {
      id: response.data.id!,
      title: response.data.snippet!.title!,
      itemCount: 0,
    };
  }

  /**
   * Gets video categories for a region
   */
  async getCategories(regionCode = 'US'): Promise<Array<{ id: string; title: string }>> {
    const response = await this.youtube.videoCategories.list({
      part: ['snippet'],
      regionCode,
    });

    return (response.data.items ?? []).map(cat => ({
      id: cat.id!,
      title: cat.snippet!.title!,
    }));
  }

  private async getVideoStream(path: string): Promise<Readable> {
    if (path.startsWith('http')) {
      const response = await fetch(path);
      return Readable.fromWeb(response.body as any);
    }
    const fs = await import('fs');
    return fs.createReadStream(path);
  }

  private async getFileSize(path: string): Promise<number> {
    if (path.startsWith('http')) {
      const response = await fetch(path, { method: 'HEAD' });
      return parseInt(response.headers.get('content-length') ?? '0');
    }
    const fs = await import('fs');
    const stats = await fs.promises.stat(path);
    return stats.size;
  }
}
```

### YouTube Categories Reference

| ID | Category |
|----|----------|
| 1 | Film & Animation |
| 22 | People & Blogs |
| 23 | Comedy |
| 24 | Entertainment |
| 25 | News & Politics |
| 27 | Education |
| 28 | Science & Technology |

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/providers/youtube/youtube-provider.ts` |
| CREATE | `packages/features/publishing/src/providers/youtube/types.ts` |
| CREATE | `packages/features/publishing/src/providers/youtube/index.ts` |

---

## Acceptance Criteria

- [x] Videos upload successfully with progress reporting — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:77`; upload run through the real SDK against a local stand-in in `packages/features/publishing/__tests__/youtube-root-url.test.ts:88`
- [x] Metadata (title, description, tags) is set correctly — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:51`
- [x] Custom thumbnails can be uploaded — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:126`; asserted in `packages/features/publishing/__tests__/youtube-root-url.test.ts:88`
- [x] Videos can be added to playlists — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:148`
- [ ] Scheduled publishing works — *audit: unverified* — provider no longer sets `publishAt` (`packages/features/publishing/src/providers/youtube/youtube-provider.ts:60`); due rows go cron → `apps/web/lambda/scheduled-publish` → publish-worker; no test drives one
- [x] Channel info can be retrieved — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:166`
- [x] Playlists can be listed and created — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:236`, `packages/features/publishing/src/providers/youtube/youtube-provider.ts:253`
- [x] Categories can be fetched — *audit:* `packages/features/publishing/src/providers/youtube/youtube-provider.ts:276`

---

## Test Plan

### Unit Tests
- [ ] Test metadata formatting — *audit: not met* — no test found
- [ ] Test category ID validation — *audit: not met* — no test found
- [ ] Test privacy status mapping — *audit: not met* — no test found

### Integration Tests
- [x] Test upload with mocked YouTube API — *audit:* `packages/features/publishing/__tests__/youtube-root-url.test.ts:88`
- [x] Test thumbnail upload — *audit:* `packages/features/publishing/__tests__/youtube-root-url.test.ts:88`
- [ ] Test playlist operations — *audit: not met* — no test found

---

## Error Handling

| Error | Handling |
|-------|----------|
| `quotaExceeded` | Notify user, suggest retry tomorrow |
| `uploadLimitExceeded` | Daily upload limit reached |
| `invalidMetadata` | Show validation errors |
| `videoProcessingFailed` | Report to user, allow retry |
| `duplicate` | Video already uploaded |

---

## Rate Limits

- 10,000 units per day per project
- Video upload: 1600 units
- Thumbnail set: 50 units
- Playlist insert: 50 units

---

## Open Questions

- [ ] Should we support live streaming? (future)
- [ ] Should we support Shorts upload? (see FILM-711)
