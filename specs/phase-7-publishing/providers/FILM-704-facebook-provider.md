---
spec_id: FILM-704
status: ✅ DONE
audited: 2026-09-23
---

# FILM-704: Facebook Provider

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-707 (Meta OAuth)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

Facebook supports video posts and Reels on Pages. Videos can be uploaded directly or via URL. This provider handles both upload methods and supports crossposting to Instagram.

---

## Specification

### Requirements

1. **Video Upload**: Upload to Page as post or Reel
2. **Resumable Upload**: Support large file uploads
3. **Metadata**: Title, description, targeting
4. **Thumbnail**: Custom thumbnail support
5. **Crosspost**: Option to crosspost to Instagram

### Provider Interface

```typescript
// packages/features/publishing/src/providers/facebook/types.ts

export interface FacebookUploadInput {
  videoPath: string;            // File path or URL
  title: string;
  description: string;
  isReel: boolean;              // Post as Reel vs regular video
  thumbnailPath?: string;
  published: boolean;           // false = draft
  scheduledPublishTime?: Date;
  targeting?: {
    ageMin?: number;
    ageMax?: number;
    geoLocations?: string[];    // Country codes
  };
  crosspostToInstagram?: boolean;
}

export interface FacebookUploadResult {
  videoId: string;
  postId?: string;
  status: 'processing' | 'ready' | 'published' | 'error';
  videoUrl?: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  pictureUrl: string;
  fanCount: number;
  accessToken: string;
}
```

### Provider Implementation

```typescript
// packages/features/publishing/src/providers/facebook/facebook-provider.ts

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

export class FacebookProvider {
  constructor(
    private accessToken: string,
    private pageId: string
  ) {}

  /**
   * Uploads a video to Facebook Page
   */
  async uploadVideo(
    input: FacebookUploadInput,
    onProgress?: (progress: number) => void
  ): Promise<FacebookUploadResult> {
    // Use resumable upload for files > 1GB
    const fileSize = await this.getFileSize(input.videoPath);
    const useResumable = fileSize > 1024 * 1024 * 1024;

    if (useResumable) {
      return this.resumableUpload(input, onProgress);
    }

    // Simple upload for smaller files
    return this.simpleUpload(input, onProgress);
  }

  /**
   * Simple upload for videos < 1GB
   */
  private async simpleUpload(
    input: FacebookUploadInput,
    onProgress?: (progress: number) => void
  ): Promise<FacebookUploadResult> {
    const formData = new FormData();

    // Add video file or URL
    if (input.videoPath.startsWith('http')) {
      formData.append('file_url', input.videoPath);
    } else {
      const fs = await import('fs');
      const videoBuffer = await fs.promises.readFile(input.videoPath);
      formData.append('source', new Blob([videoBuffer]), 'video.mp4');
    }

    // Add metadata
    formData.append('title', input.title);
    formData.append('description', input.description);
    formData.append('published', input.published.toString());

    if (input.scheduledPublishTime) {
      formData.append('scheduled_publish_time', Math.floor(input.scheduledPublishTime.getTime() / 1000).toString());
    }

    if (input.thumbnailPath) {
      if (input.thumbnailPath.startsWith('http')) {
        formData.append('thumb', input.thumbnailPath);
      }
    }

    const endpoint = input.isReel
      ? `${GRAPH_API_BASE}/${this.pageId}/video_reels`
      : `${GRAPH_API_BASE}/${this.pageId}/videos`;

    const response = await fetch(`${endpoint}?access_token=${this.accessToken}`, {
      method: 'POST',
      body: formData,
    });

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
   * Resumable upload for large files
   */
  private async resumableUpload(
    input: FacebookUploadInput,
    onProgress?: (progress: number) => void
  ): Promise<FacebookUploadResult> {
    const fileSize = await this.getFileSize(input.videoPath);

    // 1. Start upload session
    const startResponse = await fetch(
      `${GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'start',
          file_size: fileSize,
        }),
      }
    );

    const startData = await startResponse.json();
    const { upload_session_id, video_id, start_offset, end_offset } = startData;

    // 2. Upload chunks
    const fs = await import('fs');
    const chunkSize = end_offset - start_offset;
    let currentOffset = start_offset;

    while (currentOffset < fileSize) {
      const chunk = await this.readChunk(input.videoPath, currentOffset, chunkSize);

      const transferResponse = await fetch(
        `${GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_phase: 'transfer',
            upload_session_id,
            start_offset: currentOffset,
            video_file_chunk: chunk.toString('base64'),
          }),
        }
      );

      const transferData = await transferResponse.json();
      currentOffset = transferData.start_offset;

      onProgress?.(Math.round((currentOffset / fileSize) * 100));
    }

    // 3. Finish upload
    const finishResponse = await fetch(
      `${GRAPH_API_BASE}/${this.pageId}/videos?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_phase: 'finish',
          upload_session_id,
          title: input.title,
          description: input.description,
          published: input.published,
        }),
      }
    );

    const finishData = await finishResponse.json();

    return {
      videoId: video_id,
      status: input.published ? 'processing' : 'ready',
    };
  }

  /**
   * Gets video status
   */
  async getVideoStatus(videoId: string): Promise<FacebookUploadResult> {
    const response = await fetch(
      `${GRAPH_API_BASE}/${videoId}?fields=status,permalink_url&access_token=${this.accessToken}`
    );

    const data = await response.json();

    return {
      videoId,
      status: this.mapStatus(data.status?.video_status),
      videoUrl: data.permalink_url,
    };
  }

  /**
   * Gets pages the user manages
   */
  async getPages(): Promise<FacebookPage[]> {
    const response = await fetch(
      `${GRAPH_API_BASE}/me/accounts?fields=id,name,picture,fan_count,access_token&access_token=${this.accessToken}`
    );

    const data = await response.json();

    return data.data.map((page: any) => ({
      id: page.id,
      name: page.name,
      pictureUrl: page.picture?.data?.url,
      fanCount: page.fan_count,
      accessToken: page.access_token,
    }));
  }

  private mapStatus(status: string): FacebookUploadResult['status'] {
    switch (status) {
      case 'processing':
        return 'processing';
      case 'ready':
        return 'ready';
      case 'published':
        return 'published';
      default:
        return 'error';
    }
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

  private async readChunk(path: string, start: number, size: number): Promise<Buffer> {
    const fs = await import('fs');
    const handle = await fs.promises.open(path, 'r');
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, start);
    await handle.close();
    return buffer;
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/providers/facebook/facebook-provider.ts` |
| CREATE | `packages/features/publishing/src/providers/facebook/types.ts` |
| CREATE | `packages/features/publishing/src/providers/facebook/index.ts` |

---

## Acceptance Criteria

- [ ] Videos upload successfully to Page — *audit: unverified* — simple, resumable and Reel paths built (`packages/features/publishing/src/providers/facebook/facebook-provider.ts:28`); no test or sandbox run
- [ ] Resumable upload works for large files — *audit: unverified* — three-phase session above 1 GB (`packages/features/publishing/src/providers/facebook/facebook-provider.ts:253`, `packages/features/publishing/src/providers/facebook/types.ts:79`); no test
- [x] Progress reporting works — *audit:* `packages/features/publishing/src/providers/facebook/facebook-provider.ts:92`, `packages/features/publishing/src/providers/facebook/facebook-provider.ts:241`
- [x] Title and description are set — *audit:* `packages/features/publishing/src/providers/facebook/facebook-provider.ts:180`, `packages/features/publishing/src/providers/facebook/facebook-provider.ts:394`
- [ ] Scheduled publishing works — *audit: unverified* — provider can send `scheduled_publish_time` (`packages/features/publishing/src/providers/facebook/facebook-provider.ts:184`); the product schedules server-side (`packages/features/publishing/src/server/publish-actions.ts:158`); no test
- [x] Reels upload to correct endpoint — *audit:* `packages/features/publishing/src/providers/facebook/facebook-provider.ts:63`
- [x] Video status can be polled — *audit:* `packages/features/publishing/src/providers/facebook/facebook-provider.ts:443`
- [x] Page list can be retrieved — *audit:* `packages/features/publishing/src/providers/facebook/facebook-provider.ts:477`

---

## Test Plan

### Unit Tests
- [ ] Test resumable upload threshold — *audit: not met* — no test found
- [ ] Test status mapping — *audit: not met* — no test found

### Integration Tests
- [ ] Test simple upload flow — *audit: not met* — no test found
- [ ] Test resumable upload flow — *audit: not met* — no test found

---

## Constraints

- Requires Facebook Page (not personal profile)
- Video max size: 10GB
- Resumable upload: Required for files > 1GB
- Reels: 3s - 90s duration

---

## Open Questions

- [ ] Should we support Stories? (post-MVP)
- [ ] Should we support Live videos? (future)
