# FILM-511: Lip Sync

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P2 (Future Enhancement)
- **Effort:** L (1-3 days)
- **Dependencies:** FILM-502 (Voice Generation), FILM-401 (Video Generation)
- **Blocks:** None

---

## Context

Lip sync technology synchronizes generated character dialogue with video, making the characters appear to speak naturally. This significantly improves video quality and viewer immersion, especially for character-driven content.

---

## Specification

### Requirements

1. **Audio-Video Sync**: Match mouth movements to dialogue audio
2. **Provider Integration**: Integrate with lip sync APIs (Wav2Lip, SyncLabs, etc.)
3. **Face Detection**: Automatically detect faces in video frames
4. **Multi-Speaker**: Support multiple speaking characters in same shot
5. **Quality Settings**: Adjustable quality vs. processing time trade-off
6. **Preview**: Preview lip sync result before applying

### Database Schema

```sql
-- Lip sync jobs table
CREATE TABLE lip_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_id UUID NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  dialogue_line_id UUID NOT NULL REFERENCES dialogue_lines(id),
  provider VARCHAR(50) NOT NULL, -- 'wav2lip', 'synclabs', 'sadtalker'
  status VARCHAR(50) DEFAULT 'queued', -- queued, processing, completed, failed
  input_video_url TEXT NOT NULL,
  input_audio_url TEXT NOT NULL,
  output_video_url TEXT,
  face_coordinates JSONB, -- { x, y, width, height }
  quality VARCHAR(50) DEFAULT 'standard', -- 'fast', 'standard', 'high'
  provider_job_id VARCHAR(255),
  error_message TEXT,
  processing_time_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_lip_sync_shot ON lip_sync_jobs(shot_id);
```

### Provider Interface

```typescript
// packages/features/audio-generation/src/providers/lip-sync/types.ts

export interface LipSyncProvider {
  name: string;
  generateLipSync(input: LipSyncInput): Promise<string>; // Returns job ID
  getStatus(jobId: string): Promise<LipSyncResult>;
  estimateDuration(input: LipSyncInput): number; // seconds
}

export interface LipSyncInput {
  videoUrl: string;
  audioUrl: string;
  faceCoordinates?: FaceCoordinates;
  quality: 'fast' | 'standard' | 'high';
}

export interface FaceCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LipSyncResult {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  outputUrl?: string;
  error?: string;
  progress?: number;
}
```

### Lip Sync Provider (Wav2Lip Example)

```typescript
// packages/features/audio-generation/src/providers/lip-sync/wav2lip.ts

import { LipSyncProvider, LipSyncInput, LipSyncResult } from './types';

export class Wav2LipProvider implements LipSyncProvider {
  name = 'wav2lip';
  private apiKey: string;
  private baseUrl = 'https://api.wav2lip.ai/v1'; // Example API

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateLipSync(input: LipSyncInput): Promise<string> {
    const response = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_url: input.videoUrl,
        audio_url: input.audioUrl,
        face_rect: input.faceCoordinates,
        quality: input.quality,
      }),
    });

    const data = await response.json();
    return data.job_id;
  }

  async getStatus(jobId: string): Promise<LipSyncResult> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    const data = await response.json();

    return {
      status: this.mapStatus(data.status),
      outputUrl: data.output_url,
      error: data.error_message,
      progress: data.progress,
    };
  }

  estimateDuration(input: LipSyncInput): number {
    // Rough estimate based on quality
    const qualityMultiplier = {
      fast: 1,
      standard: 2,
      high: 4,
    };
    return 60 * qualityMultiplier[input.quality]; // Base 60 seconds
  }

  private mapStatus(status: string): LipSyncResult['status'] {
    const statusMap: Record<string, LipSyncResult['status']> = {
      'queued': 'pending',
      'processing': 'processing',
      'complete': 'completed',
      'error': 'failed',
    };
    return statusMap[status] || 'pending';
  }
}
```

### Server Actions

```typescript
// packages/features/audio-generation/src/server/lip-sync-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';
import { createLipSyncProvider } from '../providers/lip-sync';

export const detectFacesAction = enhanceAction(
  async ({ videoUrl }, user) => {
    // Use face detection service to find faces in video
    const faces = await detectFacesInVideo(videoUrl);
    return { faces };
  },
  {
    schema: z.object({ videoUrl: z.string().url() }),
    auth: true,
  }
);

export const generateLipSyncAction = enhanceAction(
  async ({ shotId, dialogueLineId, quality = 'standard' }, user) => {
    const client = getSupabaseServerClient();

    // Get shot and dialogue
    const { data: shot } = await client
      .from('shots')
      .select('*, episodes(project_id, projects(account_id))')
      .eq('id', shotId)
      .single();

    const { data: dialogue } = await client
      .from('dialogue_lines')
      .select('*')
      .eq('id', dialogueLineId)
      .single();

    if (!shot.video_url || !dialogue.audio_url) {
      throw new Error('Both video and audio must be generated first');
    }

    // Create lip sync job
    const { data: job } = await client
      .from('lip_sync_jobs')
      .insert({
        shot_id: shotId,
        dialogue_line_id: dialogueLineId,
        provider: 'wav2lip',
        status: 'queued',
        input_video_url: shot.video_url,
        input_audio_url: dialogue.audio_url,
        quality,
      })
      .select()
      .single();

    // Get API key and trigger lip sync
    const apiKey = await getApiKey(shot.episodes.projects.account_id, 'wav2lip');
    const provider = createLipSyncProvider('wav2lip', apiKey);

    const providerJobId = await provider.generateLipSync({
      videoUrl: shot.video_url,
      audioUrl: dialogue.audio_url,
      quality,
    });

    // Update job with provider ID
    await client
      .from('lip_sync_jobs')
      .update({
        provider_job_id: providerJobId,
        status: 'processing',
      })
      .eq('id', job.id);

    return { jobId: job.id, providerJobId };
  },
  {
    schema: z.object({
      shotId: z.string().uuid(),
      dialogueLineId: z.string().uuid(),
      quality: z.enum(['fast', 'standard', 'high']).optional(),
    }),
    auth: true,
  }
);

export const applyLipSyncAction = enhanceAction(
  async ({ jobId }, user) => {
    const client = getSupabaseServerClient();

    // Get completed lip sync job
    const { data: job } = await client
      .from('lip_sync_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('status', 'completed')
      .single();

    if (!job || !job.output_video_url) {
      throw new Error('Lip sync job not complete');
    }

    // Update shot with lip-synced video
    await client
      .from('shots')
      .update({
        video_url: job.output_video_url,
        generation_metadata: {
          lip_sync_applied: true,
          original_video_url: job.input_video_url,
          lip_sync_job_id: job.id,
        },
      })
      .eq('id', job.shot_id);

    return { success: true };
  },
  {
    schema: z.object({ jobId: z.string().uuid() }),
    auth: true,
  }
);
```

### Lip Sync Component

```typescript
// packages/features/audio-generation/src/components/lip-sync-editor.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Progress } from '@kit/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Mic, Video, Wand2, Check, AlertCircle } from 'lucide-react';
import { generateLipSyncAction, applyLipSyncAction } from '../server/lip-sync-actions';

interface LipSyncEditorProps {
  shotId: string;
  videoUrl: string;
  dialogueLines: DialogueLine[];
}

export function LipSyncEditor({ shotId, videoUrl, dialogueLines }: LipSyncEditorProps) {
  const [selectedDialogue, setSelectedDialogue] = useState<string | null>(null);
  const [quality, setQuality] = useState<'fast' | 'standard' | 'high'>('standard');
  const queryClient = useQueryClient();

  const { data: existingJob, isLoading } = useQuery({
    queryKey: ['lip-sync', shotId],
    queryFn: () => getLipSyncJobAction({ shotId }),
  });

  const generateMutation = useMutation({
    mutationFn: generateLipSyncAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lip-sync', shotId] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: applyLipSyncAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shots'] });
    },
  });

  const readyDialogues = dialogueLines.filter((d) => d.status === 'completed' && d.audio_url);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Lip Sync
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        {existingJob && (
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Current Job</span>
              <LipSyncStatusBadge status={existingJob.status} />
            </div>
            {existingJob.status === 'processing' && (
              <Progress value={existingJob.progress || 0} className="h-2" />
            )}
            {existingJob.status === 'completed' && (
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(existingJob.output_video_url, '_blank')}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => applyMutation.mutate({ jobId: existingJob.id })}
                  disabled={applyMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Apply to Shot
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Dialogue Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Dialogue</label>
          <Select value={selectedDialogue || ''} onValueChange={setSelectedDialogue}>
            <SelectTrigger>
              <SelectValue placeholder="Choose dialogue line..." />
            </SelectTrigger>
            <SelectContent>
              {readyDialogues.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.text.substring(0, 50)}...
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {readyDialogues.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Generate dialogue audio first
            </p>
          )}
        </div>

        {/* Quality Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Quality</label>
          <Select value={quality} onValueChange={(v: any) => setQuality(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast (~1 min)</SelectItem>
              <SelectItem value="standard">Standard (~2 min)</SelectItem>
              <SelectItem value="high">High Quality (~5 min)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Generate Button */}
        <Button
          className="w-full"
          onClick={() =>
            generateMutation.mutate({
              shotId,
              dialogueLineId: selectedDialogue!,
              quality,
            })
          }
          disabled={!selectedDialogue || generateMutation.isPending}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {generateMutation.isPending ? 'Processing...' : 'Generate Lip Sync'}
        </Button>
      </CardContent>
    </Card>
  );
}

function LipSyncStatusBadge({ status }: { status: string }) {
  const configs = {
    queued: { label: 'Queued', className: 'bg-slate-100 text-slate-700' },
    processing: { label: 'Processing', className: 'bg-blue-100 text-blue-700' },
    completed: { label: 'Complete', className: 'bg-green-100 text-green-700' },
    failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  };
  const config = configs[status] || configs.queued;
  return <Badge className={config.className}>{config.label}</Badge>;
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/audio-generation/src/providers/lip-sync/types.ts` |
| CREATE | `packages/features/audio-generation/src/providers/lip-sync/wav2lip.ts` |
| CREATE | `packages/features/audio-generation/src/providers/lip-sync/index.ts` |
| CREATE | `packages/features/audio-generation/src/server/lip-sync-actions.ts` |
| CREATE | `packages/features/audio-generation/src/components/lip-sync-editor.tsx` |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` |

---

## Acceptance Criteria

- [ ] Face detection identifies speakers in video
- [ ] Lip sync generates with quality settings (fast/standard/high)
- [ ] Progress tracked during processing
- [ ] Preview lip-synced video before applying
- [ ] Apply replaces original video with synced version
- [ ] Original video preserved in metadata
- [ ] Error handling for failed jobs

---

## Test Plan

### Unit Tests
- [ ] Test face detection coordinate parsing
- [ ] Test provider status mapping
- [ ] Test duration estimation

### Integration Tests
- [ ] Test full lip sync generation workflow
- [ ] Test apply lip sync to shot
- [ ] Test provider webhook handling

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| No faces detected | Prompt to select manual coordinates |
| Processing failed | Show error, allow retry with different settings |
| Audio/video missing | Prompt to generate required assets first |
