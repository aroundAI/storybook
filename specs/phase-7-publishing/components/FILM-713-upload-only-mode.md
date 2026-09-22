---
spec_id: FILM-713
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-713: Upload-Only Mode

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P2 (Future Enhancement)
- **Effort:** S (2-4 hours)
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-708 (Publish Hub), FILM-705-707 (OAuth Flows)
- **Blocks:** None

---

## Context

Some creators prefer to upload their final videos manually through native platform interfaces to access advanced features not available via API (e.g., YouTube premiere, TikTok duets settings). Upload-only mode generates all metadata, thumbnails, and descriptions but lets the user manually upload through the platform's native interface.

---

## Specification

### Requirements

1. **Export Package**: Generate downloadable package with video + metadata
2. **Platform-Specific Formatting**: Format metadata for each platform's requirements
3. **Copy-Paste Ready**: One-click copy for titles, descriptions, tags
4. **Checklist**: Guide users through manual upload steps
5. **Tracking**: Mark as "uploaded externally" for analytics tracking
6. **Link Input**: Allow user to input platform URL after manual upload

### Export Package Contents

```typescript
// packages/features/publishing/src/lib/export-package-types.ts

export interface ExportPackage {
  episodeId: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  generatedAt: string;
  video: {
    url: string;
    filename: string;
    format: string;
    resolution: string;
    duration: number;
  };
  thumbnail: {
    url: string;
    filename: string;
    dimensions: { width: number; height: number };
  };
  metadata: PlatformMetadata;
  uploadInstructions: UploadStep[];
}

export interface PlatformMetadata {
  title: string;
  description: string;
  tags: string[];
  category?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  scheduledTime?: string;
  platformSpecific?: Record<string, any>;
}

export interface UploadStep {
  step: number;
  action: string;
  details?: string;
  link?: string;
}
```

### Upload-Only Mode Component

```typescript
// packages/features/publishing/src/components/upload-only-mode.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Badge } from '@kit/ui/badge';
import { Checkbox } from '@kit/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import {
  Download,
  Copy,
  ExternalLink,
  Check,
  Youtube,
  Instagram,
  Image,
  FileText,
  Link2,
} from 'lucide-react';
import { generateExportPackageAction, markAsExternallyUploadedAction } from '../server/upload-only-actions';
import { toast } from '@kit/ui/sonner';

interface UploadOnlyModeProps {
  episodeId: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'facebook';
}

const PLATFORM_ICONS = {
  youtube: Youtube,
  tiktok: () => <span className="font-bold">TT</span>,
  instagram: Instagram,
  facebook: () => <span className="font-bold">FB</span>,
};

const PLATFORM_UPLOAD_URLS = {
  youtube: 'https://studio.youtube.com/channel/UC/videos/upload',
  tiktok: 'https://www.tiktok.com/creator#/upload',
  instagram: 'https://business.facebook.com/creatorstudio',
  facebook: 'https://business.facebook.com/creatorstudio',
};

export function UploadOnlyMode({ episodeId, platform }: UploadOnlyModeProps) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [platformUrl, setPlatformUrl] = useState('');

  const { data: exportPackage, isLoading } = useQuery({
    queryKey: ['export-package', episodeId, platform],
    queryFn: () => generateExportPackageAction({ episodeId, platform }),
  });

  const markUploadedMutation = useMutation({
    mutationFn: markAsExternallyUploadedAction,
    onSuccess: () => {
      toast.success('Marked as uploaded');
    },
  });

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const toggleStep = (step: number) => {
    setCompletedSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step]
    );
  };

  const PlatformIcon = PLATFORM_ICONS[platform];

  if (isLoading || !exportPackage) {
    return <div>Generating export package...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <PlatformIcon className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Manual Upload to {platform}</CardTitle>
              <CardDescription>
                Upload through {platform}'s native interface for advanced options
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Downloads */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="h-4 w-4" />
            Download Files
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{exportPackage.video.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {exportPackage.video.resolution} • {Math.round(exportPackage.video.duration)}s
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={exportPackage.video.url} download>
                <Download className="h-4 w-4 mr-1" />
                Download
              </a>
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <Image className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{exportPackage.thumbnail.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {exportPackage.thumbnail.dimensions.width}x{exportPackage.thumbnail.dimensions.height}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={exportPackage.thumbnail.url} download>
                <Download className="h-4 w-4 mr-1" />
                Download
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Copy Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <div className="flex gap-2">
              <Input value={exportPackage.metadata.title} readOnly className="flex-1" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(exportPackage.metadata.title, 'Title')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <div className="flex gap-2">
              <Textarea
                value={exportPackage.metadata.description}
                readOnly
                className="flex-1"
                rows={4}
              />
              <Button
                variant="outline"
                size="icon"
                className="self-start"
                onClick={() => copyToClipboard(exportPackage.metadata.description, 'Description')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-wrap gap-1 p-2 rounded-md border">
                {exportPackage.metadata.tags.map((tag, i) => (
                  <Badge key={i} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(exportPackage.metadata.tags.join(', '), 'Tags')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportPackage.uploadInstructions.map((instruction) => (
            <div
              key={instruction.step}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                completedSteps.includes(instruction.step) ? 'bg-green-50 border-green-200' : ''
              }`}
            >
              <Checkbox
                checked={completedSteps.includes(instruction.step)}
                onCheckedChange={() => toggleStep(instruction.step)}
              />
              <div className="flex-1">
                <p className="font-medium text-sm">{instruction.action}</p>
                {instruction.details && (
                  <p className="text-xs text-muted-foreground mt-1">{instruction.details}</p>
                )}
              </div>
              {instruction.link && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={instruction.link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          ))}

          <Button className="w-full" asChild>
            <a href={PLATFORM_UPLOAD_URLS[platform]} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open {platform} Upload Page
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Link Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Link Your Upload
          </CardTitle>
          <CardDescription>
            After uploading, paste the video URL here to track analytics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={`Paste your ${platform} video URL...`}
              value={platformUrl}
              onChange={(e) => setPlatformUrl(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() =>
                markUploadedMutation.mutate({
                  episodeId,
                  platform,
                  platformUrl,
                })
              }
              disabled={!platformUrl || markUploadedMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              Mark as Uploaded
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Server Actions

```typescript
// packages/features/publishing/src/server/upload-only-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

const PLATFORM_INSTRUCTIONS = {
  youtube: [
    { step: 1, action: 'Go to YouTube Studio', link: 'https://studio.youtube.com' },
    { step: 2, action: 'Click Create > Upload video' },
    { step: 3, action: 'Select your downloaded video file' },
    { step: 4, action: 'Paste the title and description' },
    { step: 5, action: 'Upload the thumbnail image' },
    { step: 6, action: 'Add tags in the "More options" section' },
    { step: 7, action: 'Set visibility and publish' },
  ],
  tiktok: [
    { step: 1, action: 'Go to TikTok Creator Center', link: 'https://www.tiktok.com/creator' },
    { step: 2, action: 'Click Upload' },
    { step: 3, action: 'Select your downloaded video file' },
    { step: 4, action: 'Paste the caption (title + description + tags)' },
    { step: 5, action: 'Select a cover frame or upload thumbnail' },
    { step: 6, action: 'Configure duet/stitch settings if needed' },
    { step: 7, action: 'Post your video' },
  ],
  instagram: [
    { step: 1, action: 'Go to Creator Studio', link: 'https://business.facebook.com/creatorstudio' },
    { step: 2, action: 'Select your Instagram account' },
    { step: 3, action: 'Click Create Post > Reels' },
    { step: 4, action: 'Upload your downloaded video file' },
    { step: 5, action: 'Paste the caption' },
    { step: 6, action: 'Upload cover image' },
    { step: 7, action: 'Share to Reels' },
  ],
  facebook: [
    { step: 1, action: 'Go to Creator Studio', link: 'https://business.facebook.com/creatorstudio' },
    { step: 2, action: 'Select your Facebook Page' },
    { step: 3, action: 'Click Create Post > Video' },
    { step: 4, action: 'Upload your downloaded video file' },
    { step: 5, action: 'Paste title and description' },
    { step: 6, action: 'Upload thumbnail image' },
    { step: 7, action: 'Publish or schedule' },
  ],
};

export const generateExportPackageAction = enhanceAction(
  async ({ episodeId, platform }, user) => {
    const client = getSupabaseServerClient();

    // Get episode with all needed data
    const { data: episode } = await client
      .from('episodes')
      .select(`
        *,
        thumbnails (*),
        publishes (*)
      `)
      .eq('id', episodeId)
      .single();

    // Get or create publish record for metadata
    let publish = episode.publishes.find((p) => p.platform === platform);
    if (!publish) {
      // Generate default metadata
      publish = {
        title: episode.title,
        description: episode.description || '',
        tags: generateDefaultTags(episode, platform),
      };
    }

    // Get platform-appropriate thumbnail
    const thumbnail = episode.thumbnails.find((t) => t.platform === platform || t.is_primary);

    return {
      episodeId,
      platform,
      generatedAt: new Date().toISOString(),
      video: {
        url: episode.final_video_url,
        filename: `${sanitizeFilename(episode.title)}.mp4`,
        format: 'mp4',
        resolution: '1080p',
        duration: episode.duration_seconds,
      },
      thumbnail: thumbnail
        ? {
            url: thumbnail.image_url,
            filename: `${sanitizeFilename(episode.title)}_thumbnail.jpg`,
            dimensions: { width: thumbnail.width, height: thumbnail.height },
          }
        : null,
      metadata: {
        title: publish.title,
        description: formatDescriptionForPlatform(publish.description, platform),
        tags: publish.tags || [],
        category: publish.metadata?.category,
      },
      uploadInstructions: PLATFORM_INSTRUCTIONS[platform],
    };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      platform: z.enum(['youtube', 'tiktok', 'instagram', 'facebook']),
    }),
    auth: true,
  }
);

export const markAsExternallyUploadedAction = enhanceAction(
  async ({ episodeId, platform, platformUrl }, user) => {
    const client = getSupabaseServerClient();

    // Extract platform content ID from URL if possible
    const platformContentId = extractContentId(platformUrl, platform);

    // Create or update publish record
    const { data: publish } = await client
      .from('publishes')
      .upsert({
        episode_id: episodeId,
        platform,
        platform_url: platformUrl,
        platform_content_id: platformContentId,
        status: 'published',
        published_at: new Date().toISOString(),
        metadata: { upload_method: 'external' },
      })
      .select()
      .single();

    return { publishId: publish.id };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      platform: z.enum(['youtube', 'tiktok', 'instagram', 'facebook']),
      platformUrl: z.string().url(),
    }),
    auth: true,
  }
);

function extractContentId(url: string, platform: string): string | null {
  const patterns = {
    youtube: /(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    tiktok: /video\/(\d+)/,
    instagram: /(?:reel|p)\/([a-zA-Z0-9_-]+)/,
    facebook: /videos\/(\d+)/,
  };
  const match = url.match(patterns[platform]);
  return match ? match[1] : null;
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/lib/export-package-types.ts` |
| CREATE | `packages/features/publishing/src/lib/schemas/upload-only.schema.ts` |
| CREATE | `packages/features/publishing/src/components/upload-only-mode.tsx` |
| CREATE | `packages/features/publishing/src/server/upload-only-actions.ts` |
| MODIFY | `packages/features/publishing/package.json` |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` |
| CREATE | `apps/web/supabase/migrations/20251210164448_make-platform-connection-id-nullable.sql` |

---

## Acceptance Criteria

- [ ] Generate downloadable video file — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:175`), but no page has ever rendered `UploadOnlyMode` (`git log -S '<UploadOnlyMode'` is empty)
- [ ] Generate downloadable thumbnail — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:197`), but no page has ever rendered `UploadOnlyMode`
- [ ] Copy-paste ready title, description, tags — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:210`), but no page has ever rendered `UploadOnlyMode`
- [ ] Platform-specific upload instructions — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:296`), but no page has ever rendered `UploadOnlyMode`
- [ ] Interactive checklist for upload steps — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:305`), but no page has ever rendered `UploadOnlyMode`
- [ ] Link to platform upload page — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:333`), but no page has ever rendered `UploadOnlyMode`
- [ ] Input for platform URL after upload — *audit: no longer true* — built (`packages/features/publishing/src/components/upload-only-mode.tsx:357`), but no page has ever rendered `UploadOnlyMode`
- [ ] Mark publish as external with URL tracking — *audit: no longer true* — `markAsExternallyUploadedAction` (`packages/features/publishing/src/server/upload-only-actions.ts:283`) is called only from that never-rendered component

---

## Test Plan

### Unit Tests
- [x] Test content ID extraction from URLs
- [x] Test filename sanitization
- [x] Test description formatting per platform

### Integration Tests
- [ ] Test export package generation — *audit: not met* — no test found
- [ ] Test external upload marking — *audit: not met* — no test found
- [ ] Test publish record creation — *audit: not met* — no test found

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Video not ready | Show message to finalize video first |
| No thumbnail | Allow upload without thumbnail |
| Invalid URL | Validate URL format before saving |

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| All eight criteria (export package, copy-ready metadata, instructions, checklist, upload link, URL capture, external marking) | Built and partly unit-tested, but no page renders `UploadOnlyMode` (`packages/features/publishing/src/components/upload-only-mode.tsx`), and none ever has: `git log -S '<UploadOnlyMode'` finds no mount | unassigned |
