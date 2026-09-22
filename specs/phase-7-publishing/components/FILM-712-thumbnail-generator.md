---
spec_id: FILM-712
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-712: Thumbnail Generator

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** M (4-8 hours)
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-708 (Publish Hub), FILM-401 (Kling Provider)
- **Blocks:** None

---

## Context

Thumbnails significantly impact click-through rates on video platforms. An AI-powered thumbnail generator creates eye-catching thumbnails from video frames, with options to add text overlays, enhance colors, and generate alternative designs. This helps creators optimize their content for each platform's requirements.

---

## Specification

### Requirements

1. **Frame Extraction**: Extract key frames from video as thumbnail candidates
2. **AI Enhancement**: Enhance frames using image generation for more appealing thumbnails
3. **Text Overlays**: Add customizable text with platform-optimized styling
4. **Platform Presets**: Pre-configured sizes for YouTube, TikTok, Instagram
5. **A/B Variants**: Generate multiple thumbnail options for testing
6. **Face Detection**: Prioritize frames with clear faces (higher engagement)

### Database Schema

```sql
-- Thumbnails table
CREATE TABLE thumbnails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  platform VARCHAR(50), -- youtube, tiktok, instagram, or null for general
  source_type VARCHAR(50) NOT NULL, -- 'frame_extract', 'ai_generated', 'uploaded'
  image_url TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  overlay_data JSONB, -- { text, font, position, colors }
  is_primary BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_thumbnails_episode ON thumbnails(episode_id);
```

### Thumbnail Generator Component

```typescript
// packages/features/publishing/src/components/thumbnail-generator.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Badge } from '@kit/ui/badge';
import {
  Image,
  Wand2,
  Type,
  Sparkles,
  Check,
  Youtube,
  Instagram,
} from 'lucide-react';
import {
  extractFramesAction,
  generateThumbnailAction,
  setThumbnailOverlayAction,
} from '../server/thumbnail-actions';

const PLATFORM_SIZES = {
  youtube: { width: 1280, height: 720, label: 'YouTube (16:9)' },
  tiktok: { width: 1080, height: 1920, label: 'TikTok (9:16)' },
  instagram: { width: 1080, height: 1080, label: 'Instagram (1:1)' },
};

interface ThumbnailGeneratorProps {
  episodeId: string;
  videoUrl: string;
}

export function ThumbnailGenerator({ episodeId, videoUrl }: ThumbnailGeneratorProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<keyof typeof PLATFORM_SIZES>('youtube');
  const [overlayText, setOverlayText] = useState('');
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: thumbnails, isLoading } = useQuery({
    queryKey: ['thumbnails', episodeId],
    queryFn: () => getThumbnailsAction({ episodeId }),
  });

  const { data: frames } = useQuery({
    queryKey: ['video-frames', episodeId],
    queryFn: () => extractFramesAction({ episodeId, videoUrl, count: 12 }),
  });

  const generateMutation = useMutation({
    mutationFn: generateThumbnailAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thumbnails', episodeId] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            <CardTitle>Thumbnail Generator</CardTitle>
          </div>
          <Tabs value={selectedPlatform} onValueChange={(v) => setSelectedPlatform(v as any)}>
            <TabsList>
              <TabsTrigger value="youtube">
                <Youtube className="h-4 w-4 mr-1" />
                YouTube
              </TabsTrigger>
              <TabsTrigger value="tiktok">TikTok</TabsTrigger>
              <TabsTrigger value="instagram">
                <Instagram className="h-4 w-4 mr-1" />
                Instagram
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Frame Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Base Frame</label>
          <div className="grid grid-cols-4 gap-2">
            {frames?.map((frame) => (
              <button
                key={frame.timestamp}
                onClick={() => setSelectedFrame(frame.url)}
                className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-colors ${
                  selectedFrame === frame.url
                    ? 'border-primary'
                    : 'border-transparent hover:border-primary/50'
                }`}
              >
                <img
                  src={frame.url}
                  alt={`Frame at ${frame.timestamp}s`}
                  className="w-full h-full object-cover"
                />
                {frame.hasFace && (
                  <Badge className="absolute top-1 right-1 text-xs">Face</Badge>
                )}
                {selectedFrame === frame.url && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <Check className="h-6 w-6 text-primary" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Text Overlay */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Text Overlay (Optional)</label>
          <div className="flex gap-2">
            <Input
              placeholder="Add eye-catching title text..."
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" size="icon">
              <Type className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Generation Options */}
        <div className="flex gap-2">
          <Button
            onClick={() =>
              generateMutation.mutate({
                episodeId,
                frameUrl: selectedFrame!,
                platform: selectedPlatform,
                overlay: overlayText ? { text: overlayText } : undefined,
                enhance: false,
              })
            }
            disabled={!selectedFrame || generateMutation.isPending}
          >
            <Image className="h-4 w-4 mr-2" />
            Create Thumbnail
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              generateMutation.mutate({
                episodeId,
                frameUrl: selectedFrame!,
                platform: selectedPlatform,
                overlay: overlayText ? { text: overlayText } : undefined,
                enhance: true,
              })
            }
            disabled={!selectedFrame || generateMutation.isPending}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AI Enhance
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              generateMutation.mutate({
                episodeId,
                frameUrl: null, // Generate from scratch
                platform: selectedPlatform,
                prompt: `Thumbnail for video: ${overlayText || 'Cinematic scene'}`,
              })
            }
            disabled={generateMutation.isPending}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Generate with AI
          </Button>
        </div>

        {/* Generated Thumbnails */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Generated Thumbnails</label>
          <div className="grid grid-cols-3 gap-4">
            {thumbnails
              ?.filter((t) => !t.platform || t.platform === selectedPlatform)
              .map((thumbnail) => (
                <ThumbnailCard
                  key={thumbnail.id}
                  thumbnail={thumbnail}
                  onSetPrimary={() => setThumbnailPrimaryAction({ thumbnailId: thumbnail.id })}
                />
              ))}
          </div>
        </div>

        {/* Platform Info */}
        <div className="text-xs text-muted-foreground">
          {PLATFORM_SIZES[selectedPlatform].label} • {PLATFORM_SIZES[selectedPlatform].width}x
          {PLATFORM_SIZES[selectedPlatform].height}px
        </div>
      </CardContent>
    </Card>
  );
}

function ThumbnailCard({ thumbnail, onSetPrimary }) {
  return (
    <div className="relative rounded-lg overflow-hidden border group">
      <img
        src={thumbnail.image_url}
        alt="Thumbnail"
        className="w-full aspect-video object-cover"
      />
      {thumbnail.is_primary && (
        <Badge className="absolute top-2 left-2">Primary</Badge>
      )}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        {!thumbnail.is_primary && (
          <Button size="sm" variant="secondary" onClick={onSetPrimary}>
            Set as Primary
          </Button>
        )}
        <Button size="sm" variant="outline">
          Download
        </Button>
      </div>
    </div>
  );
}
```

### Server Actions

```typescript
// packages/features/publishing/src/server/thumbnail-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

export const extractFramesAction = enhanceAction(
  async ({ episodeId, videoUrl, count = 12 }, user) => {
    // Use FFmpeg or video processing service to extract frames
    const frames = await extractVideoFrames(videoUrl, count);

    // Detect faces in frames for prioritization
    const framesWithMetadata = await Promise.all(
      frames.map(async (frame) => ({
        ...frame,
        hasFace: await detectFace(frame.url),
      }))
    );

    // Sort by face presence and visual quality
    return framesWithMetadata.sort((a, b) => {
      if (a.hasFace && !b.hasFace) return -1;
      if (!a.hasFace && b.hasFace) return 1;
      return 0;
    });
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      videoUrl: z.string().url(),
      count: z.number().min(1).max(24).optional(),
    }),
    auth: true,
  }
);

export const generateThumbnailAction = enhanceAction(
  async ({ episodeId, frameUrl, platform, overlay, enhance, prompt }, user) => {
    const client = getSupabaseServerClient();

    const size = PLATFORM_SIZES[platform || 'youtube'];
    let imageUrl: string;

    if (prompt && !frameUrl) {
      // Generate from scratch with AI
      imageUrl = await generateImageWithAI(prompt, size);
    } else if (enhance && frameUrl) {
      // Enhance existing frame
      imageUrl = await enhanceImage(frameUrl, size);
    } else if (frameUrl) {
      // Crop and resize frame
      imageUrl = await processFrame(frameUrl, size);
    } else {
      throw new Error('Either frameUrl or prompt is required');
    }

    // Add text overlay if provided
    if (overlay?.text) {
      imageUrl = await addTextOverlay(imageUrl, overlay);
    }

    // Save thumbnail
    const { data: thumbnail } = await client
      .from('thumbnails')
      .insert({
        episode_id: episodeId,
        platform,
        source_type: prompt ? 'ai_generated' : enhance ? 'ai_enhanced' : 'frame_extract',
        image_url: imageUrl,
        width: size.width,
        height: size.height,
        overlay_data: overlay,
      })
      .select()
      .single();

    return thumbnail;
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      frameUrl: z.string().url().nullable(),
      platform: z.enum(['youtube', 'tiktok', 'instagram']).optional(),
      overlay: z.object({
        text: z.string(),
        font: z.string().optional(),
        position: z.enum(['top', 'center', 'bottom']).optional(),
      }).optional(),
      enhance: z.boolean().optional(),
      prompt: z.string().optional(),
    }),
    auth: true,
  }
);

export const setThumbnailPrimaryAction = enhanceAction(
  async ({ thumbnailId }, user) => {
    const client = getSupabaseServerClient();

    // Get thumbnail to find episode
    const { data: thumbnail } = await client
      .from('thumbnails')
      .select('episode_id, platform')
      .eq('id', thumbnailId)
      .single();

    // Clear other primary thumbnails for same platform
    await client
      .from('thumbnails')
      .update({ is_primary: false })
      .eq('episode_id', thumbnail.episode_id)
      .eq('platform', thumbnail.platform);

    // Set as primary
    await client
      .from('thumbnails')
      .update({ is_primary: true })
      .eq('id', thumbnailId);

    // Update episode thumbnail_url
    await client
      .from('episodes')
      .update({ thumbnail_url: thumbnail.image_url })
      .eq('id', thumbnail.episode_id);

    return { success: true };
  },
  {
    schema: z.object({ thumbnailId: z.string().uuid() }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/components/thumbnail-generator.tsx` |
| CREATE | `packages/features/publishing/src/server/thumbnail-actions.ts` |
| CREATE | `packages/features/publishing/src/lib/image-processing.ts` |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` |

---

## Acceptance Criteria

- [ ] Extract 12 key frames from video — *audit: not met* — never built: `packages/features/publishing/src/components/thumbnail-generator.tsx` never existed; only the edit suite's timeline extracts frames, for display (`packages/features/edit-suite/src/components/timeline/thumbnail-strip.tsx:109`)
- [ ] Face detection prioritizes frames with faces — *audit: not met* — no working face detection: the only `detectFacesAction` is a lip-sync stub that returns nothing (`packages/features/audio-generation/src/server/lip-sync-actions.ts:104`)
- [ ] Platform-specific sizes (YouTube 1280x720, TikTok 1080x1920, Instagram 1080x1080) — *audit: not met* — thumbnails are stored one per language (`episode_thumbnails`, `apps/web/supabase/migrations/20260103042141_add_episode_thumbnails.sql`); no per-platform sizes
- [ ] Text overlay with customizable position — *audit: not met* — no thumbnail overlay; the only text overlays are on video in the edit suite (`packages/features/edit-suite/src/components/preview/text-overlay-canvas.tsx`)
- [ ] AI enhancement option improves frame quality — *audit: not met* — no AI thumbnail code anywhere
- [ ] AI generation creates thumbnail from prompt — *audit: not met* — no AI thumbnail code anywhere
- [ ] Set thumbnail as primary for episode — *audit: not met* — `setDefaultThumbnailAction` exists (`packages/features/episodes/src/server/thumbnail-actions.ts:444`); its only UI is unmounted since baa752eb
- [ ] Download thumbnails — *audit: not met* — no reachable download: only the never-rendered `UploadOnlyMode` has one (`packages/features/publishing/src/components/upload-only-mode.tsx:197`); the publish screen previews and uploads only (`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/video-card.tsx:88`)

---

## Test Plan

### Unit Tests
- [ ] Test frame extraction timing calculations — *audit: not met* — no test found
- [ ] Test platform size configurations — *audit: not met* — no test found
- [ ] Test overlay data validation — *audit: not met* — no test found

### Integration Tests
- [ ] Test full thumbnail generation workflow — *audit: not met* — no test found
- [ ] Test primary thumbnail setting — *audit: not met* — no test found
- [ ] Test AI enhancement integration — *audit: not met* — no test found

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Video processing failed | Show error, suggest uploading a different format |
| AI generation failed | Fall back to frame extraction |
| Face detection failed | Continue without face prioritization |

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Extract 12 key frames | Never built: none of the spec's files under `packages/features/publishing/src/` (`components/thumbnail-generator.tsx`, `server/thumbnail-actions.ts`, `lib/image-processing.ts`) nor its `thumbnails` table ever existed. What exists is one uploaded thumbnail per language (`episode_thumbnails`, via `packages/features/episodes/src/server/thumbnail-actions.ts`) | owner |
| Face detection | Never built for thumbnails; the only `detectFacesAction` is a stub in the retired lip-sync feature that returns an empty list | owner |
| Platform-specific sizes | Never built; thumbnails are per language, not per platform | owner |
| Text overlay | Never built for thumbnails (the edit suite's text overlays apply to video) | owner |
| AI enhancement | Never built | owner |
| AI generation from a prompt | Never built | owner |
| Set thumbnail as primary | The action exists; its only UI (`episode-thumbnail-settings.tsx`) has been unmounted since baa752eb (2026-01-06) | unassigned |
| Download thumbnails | Not reachable: the only thumbnail download is in the never-rendered `UploadOnlyMode` (`packages/features/publishing/src/components/upload-only-mode.tsx:197`; see FILM-713) | owner |
