# FILM-604: Auto-Stitch Logic

## Metadata
- **Phase:** 6 - Edit Suite
- **Priority:** P1 (Post-MVP)
- **Effort:** L (1-3 days)
- **Status:** ✅ Done
- **Dependencies:** FILM-601 (Timeline Editor) ✅, FILM-602 (Track Layer) ⚠️
- **Blocks:** Video export/rendering

> **Note:** FILM-601 Timeline Editor is complete with `TimelineData` type ready for auto-stitch integration.

---

## Context

Auto-Stitch automatically arranges generated shots and audio into a timeline when the user completes video/audio generation. This eliminates manual placement for common workflows while still allowing customization.

---

## Specification

### Requirements

1. **Automatic Sequencing**: Arrange shots in order on video track
2. **Dialogue Sync**: Align dialogue to corresponding shots
3. **Music Placement**: Position background music across episode
4. **Gap Detection**: Find and optionally fill gaps
5. **Non-destructive**: User can undo or manually adjust

### Auto-Stitch Modes

```typescript
type AutoStitchMode =
  | 'full'          // Arrange all content automatically
  | 'shots-only'    // Only arrange video shots
  | 'audio-only'    // Only arrange audio
  | 'incremental';  // Add new content to existing timeline
```

### Algorithm

```typescript
// packages/features/episodes/src/lib/auto-stitch.ts

interface AutoStitchInput {
  shots: Shot[];              // Ordered by sequence_number
  dialogueLines: DialogueLine[];
  musicTracks: AudioTrack[];
  sfxTracks: AudioTrack[];
  mode: AutoStitchMode;
  existingTimeline?: Track[];
}

interface AutoStitchOutput {
  tracks: Track[];
  warnings: AutoStitchWarning[];
  statistics: {
    totalDuration: number;
    shotCount: number;
    dialogueCount: number;
    gapsDetected: number;
  };
}

interface AutoStitchWarning {
  type: 'missing_audio' | 'gap' | 'overlap' | 'duration_mismatch';
  message: string;
  shotId?: string;
  suggestedFix?: string;
}

export function autoStitch(input: AutoStitchInput): AutoStitchOutput {
  const warnings: AutoStitchWarning[] = [];
  const tracks: Track[] = [];

  // 1. Create video track from shots
  if (input.mode !== 'audio-only') {
    const videoTrack = createVideoTrack(input.shots, warnings);
    tracks.push(videoTrack);
  }

  // 2. Create dialogue track, synced to shots
  if (input.dialogueLines.length > 0) {
    const dialogueTrack = createDialogueTrack(
      input.dialogueLines,
      input.shots,
      warnings
    );
    tracks.push(dialogueTrack);
  }

  // 3. Create music track
  if (input.musicTracks.length > 0) {
    const musicTrack = createMusicTrack(input.musicTracks, tracks);
    tracks.push(musicTrack);
  }

  // 4. Create SFX track
  if (input.sfxTracks.length > 0) {
    const sfxTrack = createSFXTrack(input.sfxTracks, input.shots);
    tracks.push(sfxTrack);
  }

  // Calculate total duration
  const totalDuration = Math.max(
    ...tracks.flatMap(t => t.clips.map(c => c.startTime + c.duration))
  );

  return {
    tracks,
    warnings,
    statistics: {
      totalDuration,
      shotCount: input.shots.length,
      dialogueCount: input.dialogueLines.length,
      gapsDetected: warnings.filter(w => w.type === 'gap').length,
    },
  };
}

function createVideoTrack(shots: Shot[], warnings: AutoStitchWarning[]): Track {
  const clips: Clip[] = [];
  let currentTime = 0;

  for (const shot of shots) {
    // Check if shot has video
    if (!shot.video_url) {
      warnings.push({
        type: 'missing_audio',
        message: `Shot ${shot.sequence_number} has no video generated`,
        shotId: shot.id,
        suggestedFix: 'Generate video for this shot',
      });
      // Add placeholder clip
      clips.push({
        id: `placeholder-${shot.id}`,
        trackId: 'video',
        name: `Shot ${shot.sequence_number} (pending)`,
        startTime: currentTime,
        duration: shot.duration_seconds,
        isPlaceholder: true,
      });
    } else {
      clips.push({
        id: `clip-${shot.id}`,
        trackId: 'video',
        assetId: shot.id,
        name: `Shot ${shot.sequence_number}`,
        startTime: currentTime,
        duration: shot.duration_seconds,
        thumbnailUrl: shot.thumbnail_url,
        assetUrl: shot.video_url,
      });
    }

    currentTime += shot.duration_seconds;
  }

  return {
    id: 'video',
    type: 'video',
    name: 'Video',
    clips,
    isMuted: false,
    isLocked: false,
    volume: 1,
  };
}

function createDialogueTrack(
  dialogueLines: DialogueLine[],
  shots: Shot[],
  warnings: AutoStitchWarning[]
): Track {
  const clips: Clip[] = [];

  // Build shot timing map
  const shotTimings = new Map<string, { start: number; end: number }>();
  let time = 0;
  for (const shot of shots) {
    shotTimings.set(shot.id, { start: time, end: time + shot.duration_seconds });
    time += shot.duration_seconds;
  }

  for (const line of dialogueLines) {
    if (!line.audio_url) {
      warnings.push({
        type: 'missing_audio',
        message: `Dialogue line "${line.text.slice(0, 30)}..." has no audio`,
        suggestedFix: 'Generate voice for this line',
      });
      continue;
    }

    // Find corresponding shot timing
    const shotTiming = line.shot_id ? shotTimings.get(line.shot_id) : null;

    // Calculate position
    let startTime: number;
    if (shotTiming) {
      // Place at start of shot with small offset
      startTime = shotTiming.start + 0.5;
    } else {
      // Place sequentially if no shot reference
      const lastClip = clips[clips.length - 1];
      startTime = lastClip ? lastClip.startTime + lastClip.duration + 0.5 : 0;
    }

    clips.push({
      id: `dialogue-${line.id}`,
      trackId: 'dialogue',
      assetId: line.id,
      name: line.text.slice(0, 30) + (line.text.length > 30 ? '...' : ''),
      startTime,
      duration: line.duration_seconds ?? 3, // Estimate if unknown
      assetUrl: line.audio_url,
    });
  }

  return {
    id: 'dialogue',
    type: 'dialogue',
    name: 'Dialogue',
    clips,
    isMuted: false,
    isLocked: false,
    volume: 1,
  };
}

function createMusicTrack(
  musicTracks: AudioTrack[],
  otherTracks: Track[]
): Track {
  // Calculate total episode duration from other tracks
  const totalDuration = Math.max(
    ...otherTracks.flatMap(t => t.clips.map(c => c.startTime + c.duration)),
    0
  );

  const clips: Clip[] = [];
  let currentTime = 0;

  for (const music of musicTracks) {
    // If music is longer than remaining time, trim it
    const remainingDuration = totalDuration - currentTime;
    const clipDuration = Math.min(music.duration_seconds, remainingDuration);

    if (clipDuration <= 0) break;

    clips.push({
      id: `music-${music.id}`,
      trackId: 'music',
      assetId: music.id,
      name: music.name,
      startTime: currentTime,
      duration: clipDuration,
      sourceStart: 0,
      sourceEnd: clipDuration,
      assetUrl: music.file_url,
      metadata: {
        fadeIn: 2,    // Default 2s fade in
        fadeOut: 2,   // Default 2s fade out
        volume: 0.3,  // Lower volume for background
      },
    });

    currentTime += clipDuration;
  }

  return {
    id: 'music',
    type: 'music',
    name: 'Music',
    clips,
    isMuted: false,
    isLocked: false,
    volume: 0.3,
  };
}

function createSFXTrack(
  sfxTracks: AudioTrack[],
  shots: Shot[]
): Track {
  // SFX placement is more complex - typically tied to shot actions
  // For now, create empty track that user fills manually
  return {
    id: 'sfx',
    type: 'sfx',
    name: 'Sound Effects',
    clips: [],
    isMuted: false,
    isLocked: false,
    volume: 1,
  };
}
```

### Gap Detection and Fill

```typescript
interface Gap {
  startTime: number;
  endTime: number;
  duration: number;
  trackId: string;
}

export function detectGaps(tracks: Track[]): Gap[] {
  const gaps: Gap[] = [];

  for (const track of tracks) {
    if (track.clips.length === 0) continue;

    // Sort clips by start time
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const gapStart = current.startTime + current.duration;
      const gapEnd = next.startTime;
      const gapDuration = gapEnd - gapStart;

      if (gapDuration > 0.1) { // Ignore tiny gaps < 100ms
        gaps.push({
          startTime: gapStart,
          endTime: gapEnd,
          duration: gapDuration,
          trackId: track.id,
        });
      }
    }
  }

  return gaps;
}

export function fillGaps(
  tracks: Track[],
  gaps: Gap[],
  strategy: 'extend' | 'black' | 'loop'
): Track[] {
  return tracks.map(track => {
    const trackGaps = gaps.filter(g => g.trackId === track.id);
    if (trackGaps.length === 0) return track;

    const newClips = [...track.clips];

    for (const gap of trackGaps) {
      if (strategy === 'extend') {
        // Extend previous clip to fill gap
        const prevClip = newClips.find(
          c => c.startTime + c.duration === gap.startTime
        );
        if (prevClip) {
          prevClip.duration += gap.duration;
        }
      } else if (strategy === 'black') {
        // Add black/silence placeholder
        newClips.push({
          id: `fill-${gap.startTime}`,
          trackId: track.id,
          name: 'Fill',
          startTime: gap.startTime,
          duration: gap.duration,
          isPlaceholder: true,
        });
      }
      // 'loop' would require more complex logic
    }

    return { ...track, clips: newClips };
  });
}
```

### Server Action

```typescript
// packages/features/episodes/src/server/auto-stitch-action.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { autoStitch, AutoStitchMode } from '../lib/auto-stitch';
import { z } from 'zod';

const AutoStitchSchema = z.object({
  episodeId: z.string().uuid(),
  mode: z.enum(['full', 'shots-only', 'audio-only', 'incremental']),
});

export const autoStitchAction = enhanceAction(
  async ({ episodeId, mode }) => {
    const client = getSupabaseServerClient();

    // Fetch all required data
    const [
      { data: shots },
      { data: dialogueLines },
      { data: audioTracks },
    ] = await Promise.all([
      client
        .from('shots')
        .select('*')
        .eq('episode_id', episodeId)
        .order('sequence_number'),
      client
        .from('dialogue_lines')
        .select('*')
        .eq('episode_id', episodeId)
        .order('sequence_number'),
      client
        .from('audio_tracks')
        .select('*')
        .eq('episode_id', episodeId),
    ]);

    // Run auto-stitch
    const result = autoStitch({
      shots: shots ?? [],
      dialogueLines: dialogueLines ?? [],
      musicTracks: audioTracks?.filter(t => t.type === 'music') ?? [],
      sfxTracks: audioTracks?.filter(t => t.type === 'sfx') ?? [],
      mode,
    });

    // Save timeline to episode
    await client
      .from('episodes')
      .update({
        metadata: {
          timeline: result.tracks,
          autoStitchedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', episodeId);

    return result;
  },
  { schema: AutoStitchSchema, auth: true }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/episodes/src/lib/auto-stitch.ts` |
| CREATE | `packages/features/episodes/src/lib/auto-stitch.test.ts` |
| CREATE | `packages/features/episodes/src/server/auto-stitch-action.ts` |

---

## Acceptance Criteria

- [x] Shots are arranged sequentially on video track
- [x] Dialogue is aligned to corresponding shots
- [x] Music is placed as background track
- [x] Warnings are generated for missing content
- [x] Gaps are detected and reported
- [x] Timeline is saved to episode metadata
- [ ] Incremental mode adds new content only (deferred to post-MVP)
- [x] Result can be undone (non-destructive: stored in episode.metadata)

---

## Test Plan

### Unit Tests
- [x] Test shot sequencing with various durations
- [x] Test dialogue alignment to shots
- [x] Test gap detection accuracy
- [x] Test gap fill strategies
- [x] Test with missing content

### Integration Tests
- [ ] Test full auto-stitch with real episode data
- [ ] Test incremental mode
- [ ] Test save to database

---

## Performance Considerations

- Process in chunks for episodes with many shots
- Use worker for gap detection on long timelines
- Cache shot timing calculations

---

## Open Questions

- [ ] Should we support AI-driven SFX placement? (post-MVP)
- [ ] Should we analyze audio for better dialogue timing? (post-MVP)
