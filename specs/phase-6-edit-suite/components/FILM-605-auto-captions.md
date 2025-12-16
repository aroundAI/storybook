# FILM-605: Auto-Captions

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** L (1-3 days)
- **Dependencies:** FILM-601 (Timeline Editor), FILM-503 (Batch Dialogue Action)
- **Blocks:** None

---

## Context

Auto-captions automatically generate synchronized subtitles from dialogue audio. This improves accessibility, enables viewers to watch without sound, and is required for certain platforms. Captions can be styled and positioned to match the project's visual design.

---

## Specification

### Requirements

1. **Speech-to-Text**: Transcribe dialogue audio to text with timestamps
2. **Word-Level Timing**: Support word-by-word timing for animated captions
3. **Caption Styling**: Customize font, size, color, background, position
4. **Caption Presets**: Pre-built styles (Standard, Bold, Minimal, Animated)
5. **Manual Editing**: Edit caption text and timing manually
6. **Multi-Language**: Support caption translation to other languages
7. **Export Formats**: SRT, VTT, burned-in video

### Database Schema

```sql
-- Captions table
CREATE TABLE captions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  language VARCHAR(10) DEFAULT 'en', -- ISO 639-1 code
  style_preset VARCHAR(50) DEFAULT 'standard',
  custom_styles JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'draft', -- draft, generating, ready
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(episode_id, language)
);

-- Caption segments
CREATE TABLE caption_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caption_id UUID NOT NULL REFERENCES captions(id) ON DELETE CASCADE,
  start_time DECIMAL NOT NULL, -- seconds
  end_time DECIMAL NOT NULL,
  text TEXT NOT NULL,
  words JSONB, -- [{ word: "hello", start: 0.0, end: 0.5 }, ...]
  speaker_id UUID REFERENCES assets(id), -- Character speaking
  sequence_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_caption_segments_caption ON caption_segments(caption_id, sequence_number);
```

### Caption Editor Component

```typescript
// packages/features/film-studio/src/components/caption-editor.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';
import { Badge } from '@kit/ui/badge';
import { Subtitles, Wand2, Download, Languages } from 'lucide-react';
import {
  generateCaptionsAction,
  updateCaptionSegmentAction,
  exportCaptionsAction,
} from '../server/caption-actions';

interface CaptionEditorProps {
  episodeId: string;
  currentTime: number;
  onSeek: (time: number) => void;
}

const STYLE_PRESETS = [
  { id: 'standard', name: 'Standard', description: 'White text, black outline' },
  { id: 'bold', name: 'Bold', description: 'Large yellow text, drop shadow' },
  { id: 'minimal', name: 'Minimal', description: 'Small gray text, bottom left' },
  { id: 'animated', name: 'Animated', description: 'Word-by-word highlight' },
];

export function CaptionEditor({ episodeId, currentTime, onSeek }: CaptionEditorProps) {
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedPreset, setSelectedPreset] = useState('standard');
  const queryClient = useQueryClient();

  const { data: captions, isLoading } = useQuery({
    queryKey: ['captions', episodeId, selectedLanguage],
    queryFn: () => getCaptionsAction({ episodeId, language: selectedLanguage }),
  });

  const generateMutation = useMutation({
    mutationFn: generateCaptionsAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captions', episodeId] });
    },
  });

  const currentSegment = captions?.segments.find(
    (s) => currentTime >= s.start_time && currentTime <= s.end_time
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Subtitles className="h-5 w-5" />
            <CardTitle>Captions</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="de">German</SelectItem>
                <SelectItem value="ja">Japanese</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateMutation.mutate({ episodeId, language: selectedLanguage })}
              disabled={generateMutation.isPending}
            >
              <Wand2 className="h-4 w-4 mr-1" />
              {generateMutation.isPending ? 'Generating...' : 'Auto-Generate'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Style Presets */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Style</label>
          <div className="grid grid-cols-4 gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  selectedPreset === preset.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="font-medium text-sm">{preset.name}</div>
                <div className="text-xs text-muted-foreground">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Caption Segments */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Segments</label>
            <Badge variant="outline">
              {captions?.segments.length || 0} segments
            </Badge>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {captions?.segments.map((segment, index) => (
              <CaptionSegmentRow
                key={segment.id}
                segment={segment}
                isActive={segment.id === currentSegment?.id}
                onSeek={() => onSeek(segment.start_time)}
                onUpdate={(text) => updateCaptionSegmentAction({
                  segmentId: segment.id,
                  text,
                })}
              />
            ))}
          </div>
        </div>

        {/* Export Options */}
        <div className="flex items-center gap-2 pt-4 border-t">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export SRT
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export VTT
          </Button>
          <Button variant="outline" size="sm">
            <Languages className="h-4 w-4 mr-1" />
            Translate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CaptionSegmentRow({ segment, isActive, onSeek, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment.text);

  return (
    <div
      className={`p-2 rounded cursor-pointer transition-colors ${
        isActive ? 'bg-primary/20 border-l-2 border-primary' : 'hover:bg-muted'
      }`}
      onClick={onSeek}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>{formatTime(segment.start_time)} - {formatTime(segment.end_time)}</span>
        {segment.speaker_id && <Badge variant="outline" className="text-xs">Speaker</Badge>}
      </div>
      {editing ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            onUpdate(text);
            setEditing(false);
          }}
          autoFocus
          className="min-h-0 text-sm"
        />
      ) : (
        <p
          className="text-sm"
          onDoubleClick={() => setEditing(true)}
        >
          {segment.text}
        </p>
      )}
    </div>
  );
}
```

### Server Actions

```typescript
// packages/features/film-studio/src/server/caption-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

export const generateCaptionsAction = enhanceAction(
  async ({ episodeId, language = 'en' }, user) => {
    const client = getSupabaseServerClient();

    // Get dialogue lines with audio
    const { data: dialogues } = await client
      .from('dialogue_lines')
      .select('*, audio_url')
      .eq('episode_id', episodeId)
      .eq('status', 'completed')
      .order('sequence_number');

    if (!dialogues?.length) {
      throw new Error('No dialogue audio found. Generate dialogue first.');
    }

    // Create or update captions record
    const { data: caption } = await client
      .from('captions')
      .upsert({
        episode_id: episodeId,
        language,
        status: 'generating',
      })
      .select()
      .single();

    // Process each dialogue line
    const segments = [];
    let currentTime = 0;

    for (const dialogue of dialogues) {
      // Call speech-to-text API (e.g., Whisper)
      const transcription = await transcribeAudio(dialogue.audio_url);

      for (const segment of transcription.segments) {
        segments.push({
          caption_id: caption.id,
          start_time: currentTime + segment.start,
          end_time: currentTime + segment.end,
          text: segment.text,
          words: segment.words,
          speaker_id: dialogue.character_asset_id,
          sequence_number: segments.length + 1,
        });
      }

      currentTime += transcription.duration;
    }

    // Insert segments
    await client.from('caption_segments').insert(segments);

    // Update status
    await client
      .from('captions')
      .update({ status: 'ready' })
      .eq('id', caption.id);

    return { captionId: caption.id, segmentCount: segments.length };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      language: z.string().length(2).optional(),
    }),
    auth: true,
  }
);

export const exportCaptionsAction = enhanceAction(
  async ({ episodeId, language, format }, user) => {
    const client = getSupabaseServerClient();

    const { data: caption } = await client
      .from('captions')
      .select('*, caption_segments(*)')
      .eq('episode_id', episodeId)
      .eq('language', language)
      .order('sequence_number', { foreignTable: 'caption_segments' })
      .single();

    if (format === 'srt') {
      return generateSRT(caption.caption_segments);
    } else if (format === 'vtt') {
      return generateVTT(caption.caption_segments);
    }

    throw new Error(`Unknown format: ${format}`);
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      language: z.string().length(2),
      format: z.enum(['srt', 'vtt']),
    }),
    auth: true,
  }
);

function generateSRT(segments: CaptionSegment[]): string {
  return segments
    .map((segment, index) => {
      const start = formatSRTTime(segment.start_time);
      const end = formatSRTTime(segment.end_time);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join('\n');
}

function generateVTT(segments: CaptionSegment[]): string {
  const header = 'WEBVTT\n\n';
  const body = segments
    .map((segment) => {
      const start = formatVTTTime(segment.start_time);
      const end = formatVTTTime(segment.end_time);
      return `${start} --> ${end}\n${segment.text}\n`;
    })
    .join('\n');
  return header + body;
}
```

### File Changes

| Action | Path | Status |
|--------|------|--------|
| CREATE | `apps/web/supabase/schemas/31-captions.sql` | ✅ Complete |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` | ✅ Complete (added 'transcription', 'translation' to job_type) |
| CREATE | `packages/llm/src/transcription.ts` | ✅ Complete (WhisperTranscriptionService) |
| CREATE | `packages/features/film-studio/src/lib/schemas/caption.schema.ts` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/lib/caption-utils.ts` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/server/caption-actions.ts` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/components/caption-editor/caption-editor.tsx` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/components/caption-editor/caption-segment-list.tsx` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/components/caption-editor/caption-style-selector.tsx` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/components/caption-editor/translate-dialog.tsx` | ✅ Complete |
| CREATE | `packages/features/film-studio/src/components/caption-editor/index.ts` | ✅ Complete |
| CREATE | `packages/features/film-studio/__tests__/caption-utils.test.ts` | ✅ Complete |
| MODIFY | `packages/features/film-studio/src/components/index.ts` | ✅ Complete |
| MODIFY | `packages/features/film-studio/src/lib/index.ts` | ✅ Complete |
| MODIFY | `packages/features/film-studio/src/server/index.ts` | ✅ Complete |
| MODIFY | `packages/llm/src/index.ts` | ✅ Complete |

---

## Acceptance Criteria

- [x] Auto-generate captions from dialogue audio (generateCaptionsAction with Whisper API)
- [x] Word-level timing data captured (WhisperTranscriptionService returns word-level timing)
- [x] 4 style presets available (standard, bold, minimal, animated)
- [x] Caption segments editable inline (CaptionSegmentList with inline editing)
- [x] Click segment to seek to timestamp (onSegmentClick callback)
- [x] Export to SRT format (exportCaptionsAction with format: 'srt')
- [x] Export to VTT format (exportCaptionsAction with format: 'vtt')
- [x] Multi-language support with translation option (translateCaptionsAction with LLM translation)
- [x] Captions synchronized with video preview (currentTime prop with auto-scroll)

---

## Test Plan

### Unit Tests
- [x] Test SRT format generation (exportToSrt in caption-utils.test.ts)
- [x] Test VTT format generation (exportToVtt in caption-utils.test.ts)
- [x] Test timestamp formatting functions (formatSrtTime, formatVttTime, formatDisplayTime)
- [x] Test segment timing calculations (parseSrtTime, parseVttTime, splitSegment)
- [x] Test segment merging logic (mergeSegments)
- [x] Test segment validation (validateSegments)
- [x] Test SRT/VTT parsing (parseSrt, parseVtt)

### Integration Tests
- [ ] Test full caption generation workflow
- [ ] Test caption export with various segment counts
- [ ] Test caption update and persistence

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| No dialogue audio | Prompt to generate dialogue first |
| Transcription failed | Show error, allow retry |
| Export failed | Display error message |

---

## Accessibility Considerations

- Captions improve accessibility for deaf/hard-of-hearing viewers
- High contrast caption styles available
- Caption position adjustable to avoid covering important content
