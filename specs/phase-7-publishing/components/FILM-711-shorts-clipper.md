---
spec_id: FILM-711
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-711: Shorts Clipper

> **🗑️ Retired (audit 2026-09-23).** The in-app clipper (`shorts-clipper.tsx`, `clip-actions.ts`, `clip.schema.ts` under `packages/features/publishing/src/`) was rendered only inside `PublishHub`, which lost its page in baa752eb (2026-01-06); f4efd8b9 (2026-01-18) deleted it as dead code. Short-form video is now uploaded per language as shorts groups on the publish screen (`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/publish/_components/shorts-section.tsx`). `@kit/shorts` can still cut shots flagged `shorts_candidate` to 9:16 with ffmpeg (`packages/features/shorts/src/server/generate-short-action.ts:95`), but its page (`apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/shorts-studio/page.tsx`) is linked from nowhere. Kept as a record; not outstanding work.

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P1 (Post-MVP)
- **Effort:** L (1-3 days)
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ DONE)
- **Dependencies:** FILM-601 (Timeline Editor), FILM-604 (Auto-Stitch)
- **Blocks:** FILM-708 (Publish Hub)

---

## Context

The Shorts Clipper allows users to create short-form clips (15-60 seconds) from full-length videos for TikTok, Instagram Reels, and YouTube Shorts. It provides clip selection, aspect ratio conversion, and quick editing tools.

---

## Specification

### Requirements

1. **Clip Selection**: Choose start/end points for clips
2. **Multiple Clips**: Create multiple clips from one video
3. **Aspect Ratio**: Convert to 9:16 vertical format
4. **Preview**: Preview clips before generating
5. **Crop/Pan**: Adjust framing for vertical format
6. **Export**: Generate and store clip files
7. **Suggestions**: AI-suggested clip moments (future)

### Component Interface

```typescript
// packages/features/publishing/src/components/shorts-clipper.tsx

interface ShortsClipperProps {
  videoUrl: string;
  duration: number; // seconds
  episodeId: string;
  onClipCreated: (clip: GeneratedClip) => void;
}

interface ClipRegion {
  id: string;
  startTime: number;
  endTime: number;
  title: string;
  cropSettings: CropSettings;
}

interface CropSettings {
  type: 'center' | 'left' | 'right' | 'smart' | 'custom';
  x: number; // 0-1 normalized position
  y: number;
  scale: number;
}

interface GeneratedClip {
  id: string;
  clipUrl: string;
  thumbnailUrl: string;
  duration: number;
  title: string;
  aspectRatio: '9:16' | '1:1';
}

// Platform constraints
const SHORTS_CONSTRAINTS = {
  youtube: { minDuration: 15, maxDuration: 60, aspectRatio: '9:16' },
  tiktok: { minDuration: 3, maxDuration: 600, aspectRatio: '9:16' },
  instagram: { minDuration: 3, maxDuration: 90, aspectRatio: '9:16' },
};
```

### Component Implementation

```tsx
// packages/features/publishing/src/components/shorts-clipper.tsx

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Slider } from '@kit/ui/slider';
import { Badge } from '@kit/ui/badge';
import { Progress } from '@kit/ui/progress';
import {
  Play,
  Pause,
  Scissors,
  Plus,
  Trash2,
  Download,
  RefreshCw,
  Crop,
  Maximize2,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyEnd,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

import { generateClipAction } from '../server/clip-actions';
import { formatTime } from '../lib/format-time';

export function ShortsClipper({
  videoUrl,
  duration,
  episodeId,
  onClipCreated,
}: ShortsClipperProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [clips, setClips] = useState<ClipRegion[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [generatingClipId, setGeneratingClipId] = useState<string | null>(null);

  const selectedClip = clips.find(c => c.id === selectedClipId);

  // Video controls
  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Update current time as video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, []);

  // Add new clip at current position
  const addClip = useCallback(() => {
    const newClip: ClipRegion = {
      id: crypto.randomUUID(),
      startTime: Math.max(0, currentTime - 15),
      endTime: Math.min(duration, currentTime + 15),
      title: `Clip ${clips.length + 1}`,
      cropSettings: {
        type: 'center',
        x: 0.5,
        y: 0.5,
        scale: 1,
      },
    };
    setClips([...clips, newClip]);
    setSelectedClipId(newClip.id);
  }, [clips, currentTime, duration]);

  // Update clip
  const updateClip = useCallback((clipId: string, updates: Partial<ClipRegion>) => {
    setClips(clips.map(c => c.id === clipId ? { ...c, ...updates } : c));
  }, [clips]);

  // Delete clip
  const deleteClip = useCallback((clipId: string) => {
    setClips(clips.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
  }, [clips, selectedClipId]);

  // Generate clip mutation
  const generateMutation = useMutation({
    mutationFn: async (clip: ClipRegion) => {
      setGeneratingClipId(clip.id);
      return generateClipAction({
        episodeId,
        videoUrl,
        startTime: clip.startTime,
        endTime: clip.endTime,
        title: clip.title,
        cropSettings: clip.cropSettings,
        aspectRatio: '9:16',
      });
    },
    onSuccess: (result, clip) => {
      setGeneratingClipId(null);
      onClipCreated(result);
      // Mark clip as generated
      updateClip(clip.id, { generated: true, generatedUrl: result.clipUrl });
    },
    onError: () => {
      setGeneratingClipId(null);
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Video Preview */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardContent className="p-4">
            {/* Video Container with Vertical Preview Overlay */}
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full aspect-video"
                onEnded={() => setIsPlaying(false)}
              />

              {/* 9:16 Preview Overlay */}
              {selectedClip && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    className="border-2 border-dashed border-white/50 bg-black/20"
                    style={{
                      width: `${(9 / 16) * 100}%`,
                      height: '100%',
                      transform: `translateX(${(selectedClip.cropSettings.x - 0.5) * 100}%)`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Transport Controls */}
            <div className="mt-4 space-y-2">
              {/* Timeline */}
              <TimelineSlider
                duration={duration}
                currentTime={currentTime}
                clips={clips}
                selectedClipId={selectedClipId}
                onSeek={seekTo}
                onClipSelect={setSelectedClipId}
              />

              {/* Playback Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={togglePlay}>
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <span className="text-sm font-mono">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <Button onClick={addClip}>
                  <Scissors className="mr-2 h-4 w-4" />
                  Mark Clip at {formatTime(currentTime)}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clips Panel */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clips ({clips.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {clips.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Scissors className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No clips yet</p>
                <p className="text-sm">Play the video and mark moments to create clips</p>
              </div>
            ) : (
              clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  isSelected={selectedClipId === clip.id}
                  isGenerating={generatingClipId === clip.id}
                  onSelect={() => {
                    setSelectedClipId(clip.id);
                    seekTo(clip.startTime);
                  }}
                  onUpdate={(updates) => updateClip(clip.id, updates)}
                  onDelete={() => deleteClip(clip.id)}
                  onGenerate={() => generateMutation.mutate(clip)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Selected Clip Editor */}
        {selectedClip && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Edit Clip</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label>Clip Title</Label>
                <Input
                  value={selectedClip.title}
                  onChange={(e) => updateClip(selectedClip.id, { title: e.target.value })}
                />
              </div>

              {/* Time Range */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start</Label>
                  <Input
                    type="number"
                    value={selectedClip.startTime.toFixed(1)}
                    onChange={(e) =>
                      updateClip(selectedClip.id, { startTime: parseFloat(e.target.value) || 0 })
                    }
                    step="0.1"
                    min={0}
                    max={selectedClip.endTime - 3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End</Label>
                  <Input
                    type="number"
                    value={selectedClip.endTime.toFixed(1)}
                    onChange={(e) =>
                      updateClip(selectedClip.id, { endTime: parseFloat(e.target.value) || 0 })
                    }
                    step="0.1"
                    min={selectedClip.startTime + 3}
                    max={duration}
                  />
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                Duration: {formatTime(selectedClip.endTime - selectedClip.startTime)}
              </div>

              {/* Crop Position */}
              <div className="space-y-2">
                <Label>Vertical Crop Position</Label>
                <div className="flex gap-2">
                  <Button
                    variant={selectedClip.cropSettings.type === 'left' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      updateClip(selectedClip.id, {
                        cropSettings: { ...selectedClip.cropSettings, type: 'left', x: 0.25 },
                      })
                    }
                  >
                    <AlignHorizontalJustifyStart className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedClip.cropSettings.type === 'center' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      updateClip(selectedClip.id, {
                        cropSettings: { ...selectedClip.cropSettings, type: 'center', x: 0.5 },
                      })
                    }
                  >
                    <AlignHorizontalJustifyCenter className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedClip.cropSettings.type === 'right' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      updateClip(selectedClip.id, {
                        cropSettings: { ...selectedClip.cropSettings, type: 'right', x: 0.75 },
                      })
                    }
                  >
                    <AlignHorizontalJustifyEnd className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Fine-tune position */}
              <div className="space-y-2">
                <Label>Fine-tune Position</Label>
                <Slider
                  value={[selectedClip.cropSettings.x * 100]}
                  onValueChange={([value]) =>
                    updateClip(selectedClip.id, {
                      cropSettings: { ...selectedClip.cropSettings, type: 'custom', x: value / 100 },
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

interface ClipCardProps {
  clip: ClipRegion;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<ClipRegion>) => void;
  onDelete: () => void;
  onGenerate: () => void;
}

function ClipCard({
  clip,
  isSelected,
  isGenerating,
  onSelect,
  onUpdate,
  onDelete,
  onGenerate,
}: ClipCardProps) {
  const clipDuration = clip.endTime - clip.startTime;

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{clip.title}</div>
          <div className="text-sm text-muted-foreground">
            {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
            <Badge variant="secondary" className="ml-2">
              {formatTime(clipDuration)}
            </Badge>
          </div>
        </div>

        <div className="flex gap-1">
          {clip.generated ? (
            <Badge variant="default" className="bg-green-500">Generated</Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate();
              }}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface TimelineSliderProps {
  duration: number;
  currentTime: number;
  clips: ClipRegion[];
  selectedClipId: string | null;
  onSeek: (time: number) => void;
  onClipSelect: (id: string) => void;
}

function TimelineSlider({
  duration,
  currentTime,
  clips,
  selectedClipId,
  onSeek,
  onClipSelect,
}: TimelineSliderProps) {
  return (
    <div className="relative h-8 bg-muted rounded">
      {/* Clip regions */}
      {clips.map((clip) => (
        <div
          key={clip.id}
          className={`absolute h-full rounded cursor-pointer transition-opacity ${
            selectedClipId === clip.id
              ? 'bg-primary/50'
              : 'bg-primary/30 hover:bg-primary/40'
          }`}
          style={{
            left: `${(clip.startTime / duration) * 100}%`,
            width: `${((clip.endTime - clip.startTime) / duration) * 100}%`,
          }}
          onClick={() => onClipSelect(clip.id)}
        />
      ))}

      {/* Playhead */}
      <div
        className="absolute top-0 w-0.5 h-full bg-white shadow-lg pointer-events-none"
        style={{ left: `${(currentTime / duration) * 100}%` }}
      />

      {/* Click to seek */}
      <div
        className="absolute inset-0 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const newTime = (x / rect.width) * duration;
          onSeek(newTime);
        }}
      />
    </div>
  );
}
```

### Server Action for Clip Generation

```typescript
// packages/features/publishing/src/server/clip-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

const GenerateClipSchema = z.object({
  episodeId: z.string().uuid(),
  videoUrl: z.string().url(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  title: z.string(),
  cropSettings: z.object({
    type: z.enum(['center', 'left', 'right', 'smart', 'custom']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(0.5).max(2),
  }),
  aspectRatio: z.enum(['9:16', '1:1']),
});

export const generateClipAction = enhanceAction(
  async ({ episodeId, videoUrl, startTime, endTime, title, cropSettings, aspectRatio }) => {
    const client = getSupabaseServerClient();

    // Create clip generation job
    const { data: job } = await client
      .from('generation_jobs')
      .insert({
        job_type: 'clip',
        reference_type: 'episode',
        reference_id: episodeId,
        status: 'processing',
        input_data: {
          videoUrl,
          startTime,
          endTime,
          title,
          cropSettings,
          aspectRatio,
        },
      })
      .select()
      .single();

    // In production, this would call FFmpeg or a video processing service
    // For now, simulate clip generation
    const clipUrl = await processClip({
      videoUrl,
      startTime,
      endTime,
      cropSettings,
      aspectRatio,
    });

    // Generate thumbnail from first frame
    const thumbnailUrl = await generateClipThumbnail(clipUrl);

    // Update job and create clip record
    await client
      .from('generation_jobs')
      .update({
        status: 'completed',
        output_data: { clipUrl, thumbnailUrl },
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return {
      id: job.id,
      clipUrl,
      thumbnailUrl,
      duration: endTime - startTime,
      title,
      aspectRatio,
    };
  },
  { schema: GenerateClipSchema, auth: true }
);

async function processClip(options: {
  videoUrl: string;
  startTime: number;
  endTime: number;
  cropSettings: any;
  aspectRatio: string;
}): Promise<string> {
  // This would use FFmpeg or a cloud video processing service
  // Example FFmpeg command:
  // ffmpeg -i input.mp4 -ss startTime -to endTime
  //   -vf "crop=ih*9/16:ih:iw*cropX-(ih*9/16/2):0,scale=1080:1920"
  //   -c:a copy output.mp4

  // For now, return placeholder
  return `${options.videoUrl}?clip=${options.startTime}-${options.endTime}`;
}

async function generateClipThumbnail(clipUrl: string): Promise<string> {
  // Extract first frame as thumbnail
  return clipUrl.replace('.mp4', '_thumb.jpg');
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/components/shorts-clipper.tsx` |
| CREATE | `packages/features/publishing/src/server/clip-actions.ts` |
| CREATE | `packages/features/publishing/src/lib/format-time.ts` |

---

## Acceptance Criteria

- [ ] Video plays with transport controls
- [ ] Clips can be marked at current time
- [ ] Clip regions shown on timeline
- [ ] Clips can be selected and edited
- [ ] Start/end times adjustable with validation
- [ ] Crop position can be adjusted
- [ ] Clips can be generated
- [ ] Generated clips downloadable
- [ ] Multiple clips supported
- [ ] Clips can be deleted
- [ ] Duration warnings for platform limits

---

## Test Plan

### Unit Tests
- [ ] Test time formatting
- [ ] Test clip region validation
- [ ] Test crop position calculations

### Integration Tests
- [ ] Test clip generation flow

### E2E Tests
- [ ] Full clip creation workflow

---

## Performance Considerations

- Video scrubbing should be smooth
- Preview overlay rendered with CSS (not canvas)
- Clip regions use CSS positioning
- Generation runs asynchronously

---

## Future Enhancements

- [ ] AI-suggested clip moments based on engagement signals
- [ ] Face detection for smart cropping
- [ ] Audio waveform visualization
- [ ] Caption auto-generation for clips
