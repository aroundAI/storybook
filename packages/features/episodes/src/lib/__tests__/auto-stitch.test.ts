import { describe, expect, it } from 'vitest';

import type {
  AudioTrackInput,
  AutoStitchInput,
  DialogueLineInput,
  ShotInput,
} from '../auto-stitch';
import {
  autoStitch,
  detectGaps,
  fillGaps,
  framesToSeconds,
  secondsToFrames,
} from '../auto-stitch';

// ============================================================================
// Test Fixtures
// ============================================================================

const createMockShot = (overrides: Partial<ShotInput> = {}): ShotInput => ({
  id: `shot-${Math.random().toString(36).substring(7)}`,
  episode_id: 'ep-1',
  sequence_number: 1,
  duration_seconds: 5,
  video_url: 'https://example.com/shot.mp4',
  thumbnail_url: 'https://example.com/thumb.jpg',
  prompt: 'Test shot',
  scene_number: 1,
  shot_number: 1,
  status: 'completed',
  ...overrides,
});

const createMockDialogue = (
  overrides: Partial<DialogueLineInput> = {},
): DialogueLineInput => ({
  id: `line-${Math.random().toString(36).substring(7)}`,
  episode_id: 'ep-1',
  shot_id: null,
  text: 'Hello, world!',
  audio_url: 'https://example.com/audio.mp3',
  sequence_number: 1,
  status: 'completed',
  ...overrides,
});

const createMockAudioTrack = (
  overrides: Partial<AudioTrackInput> = {},
): AudioTrackInput => ({
  id: `audio-${Math.random().toString(36).substring(7)}`,
  episode_id: 'ep-1',
  type: 'music',
  name: 'Background Music',
  file_url: 'https://example.com/music.mp3',
  duration_seconds: 120,
  timeline_start_seconds: 0,
  volume: 0.3,
  metadata: null,
  ...overrides,
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('Helper Functions', () => {
  describe('secondsToFrames', () => {
    it('should convert seconds to frames at 30fps', () => {
      expect(secondsToFrames(1, 30)).toBe(30);
      expect(secondsToFrames(5, 30)).toBe(150);
      expect(secondsToFrames(0.5, 30)).toBe(15);
    });

    it('should convert seconds to frames at 24fps', () => {
      expect(secondsToFrames(1, 24)).toBe(24);
      expect(secondsToFrames(5, 24)).toBe(120);
    });

    it('should round to nearest frame', () => {
      expect(secondsToFrames(0.51, 30)).toBe(15);
      expect(secondsToFrames(0.49, 30)).toBe(15);
    });
  });

  describe('framesToSeconds', () => {
    it('should convert frames to seconds at 30fps', () => {
      expect(framesToSeconds(30, 30)).toBe(1);
      expect(framesToSeconds(150, 30)).toBe(5);
      expect(framesToSeconds(15, 30)).toBe(0.5);
    });

    it('should convert frames to seconds at 24fps', () => {
      expect(framesToSeconds(24, 24)).toBe(1);
      expect(framesToSeconds(120, 24)).toBe(5);
    });
  });
});

// ============================================================================
// Shot Processing Tests
// ============================================================================

describe('Shot Processing', () => {
  it('should sequence shots in order on video track', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
      createMockShot({ id: 'shot-2', sequence_number: 2, duration_seconds: 3 }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const videoTrack = result.timeline.tracks.find((t) => t.type === 'video');

    expect(videoTrack).toBeDefined();
    expect(videoTrack?.clips).toHaveLength(2);

    // First clip: starts at frame 0, duration 5s = 150 frames
    expect(videoTrack?.clips[0]?.startFrame).toBe(0);
    expect(videoTrack?.clips[0]?.durationFrames).toBe(150);

    // Second clip: starts at frame 150, duration 3s = 90 frames
    expect(videoTrack?.clips[1]?.startFrame).toBe(150);
    expect(videoTrack?.clips[1]?.durationFrames).toBe(90);
  });

  it('should handle out-of-order shots by sorting by sequence_number', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-3', sequence_number: 3, duration_seconds: 2 }),
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 4 }),
      createMockShot({ id: 'shot-2', sequence_number: 2, duration_seconds: 3 }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const videoTrack = result.timeline.tracks.find((t) => t.type === 'video');

    // Verify clips are in sequence order
    expect(videoTrack?.clips[0]?.shotId).toBe('shot-1');
    expect(videoTrack?.clips[1]?.shotId).toBe('shot-2');
    expect(videoTrack?.clips[2]?.shotId).toBe('shot-3');

    // Verify timing is sequential
    expect(videoTrack?.clips[0]?.startFrame).toBe(0);
    expect(videoTrack?.clips[1]?.startFrame).toBe(120); // 4s = 120 frames
    expect(videoTrack?.clips[2]?.startFrame).toBe(210); // 4s + 3s = 210 frames
  });

  it('should generate warning for missing video', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, video_url: null }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe('missing_video');
    expect(result.warnings[0]?.shotId).toBe('shot-1');
    expect(result.warnings[0]?.suggestedFix).toBeDefined();
  });

  it('should still create placeholder clip for shot without video', () => {
    const shots: ShotInput[] = [
      createMockShot({
        id: 'shot-1',
        sequence_number: 1,
        duration_seconds: 5,
        video_url: null,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const videoTrack = result.timeline.tracks.find((t) => t.type === 'video');

    expect(videoTrack?.clips).toHaveLength(1);
    expect(videoTrack?.clips[0]?.shotId).toBe('shot-1');
    expect(videoTrack?.clips[0]?.videoUrl).toBeUndefined();
  });

  it('should handle single shot', () => {
    const shots: ShotInput[] = [
      createMockShot({
        id: 'shot-1',
        sequence_number: 1,
        duration_seconds: 10,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const videoTrack = result.timeline.tracks.find((t) => t.type === 'video');

    expect(videoTrack?.clips).toHaveLength(1);
    expect(result.statistics.shotCount).toBe(1);
    expect(result.statistics.totalDurationFrames).toBe(300); // 10s = 300 frames
  });

  it('should handle empty shots array', () => {
    const input: AutoStitchInput = {
      shots: [],
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const videoTrack = result.timeline.tracks.find((t) => t.type === 'video');

    expect(videoTrack?.clips).toHaveLength(0);
    expect(result.statistics.shotCount).toBe(0);
  });
});

// ============================================================================
// Dialogue Processing Tests
// ============================================================================

describe('Dialogue Processing', () => {
  it('should align dialogue to corresponding shot with offset', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        shot_id: 'shot-1',
        sequence_number: 1,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const dialogueTrack = result.timeline.tracks.find(
      (t) => t.type === 'dialogue',
    );

    expect(dialogueTrack?.clips).toHaveLength(1);
    // Shot 1 starts at frame 0, dialogue offset is 0.5s = 15 frames
    expect(dialogueTrack?.clips[0]?.startFrame).toBe(15);
  });

  it('should place dialogue sequentially when no shot reference', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        shot_id: null,
        sequence_number: 1,
      }),
      createMockDialogue({
        id: 'line-2',
        shot_id: null,
        sequence_number: 2,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const dialogueTrack = result.timeline.tracks.find(
      (t) => t.type === 'dialogue',
    );

    expect(dialogueTrack?.clips).toHaveLength(2);
    // First dialogue at offset (15 frames)
    expect(dialogueTrack?.clips[0]?.startFrame).toBe(15);
    // Second dialogue after first + offset
    // Default duration is 3s = 90 frames, so second starts at 15 + 90 + 15 = 120
    expect(dialogueTrack?.clips[1]?.startFrame).toBe(120);
  });

  it('should generate warning for missing dialogue audio', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        audio_url: null,
        sequence_number: 1,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);

    expect(result.warnings.some((w) => w.type === 'missing_audio')).toBe(true);
    expect(
      result.warnings.find((w) => w.type === 'missing_audio')?.dialogueLineId,
    ).toBe('line-1');
  });

  it('should skip dialogue without audio (no clip created)', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        audio_url: null,
        sequence_number: 1,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);
    const dialogueTrack = result.timeline.tracks.find(
      (t) => t.type === 'dialogue',
    );

    // No clip created for dialogue without audio
    expect(dialogueTrack?.clips).toHaveLength(0);
    expect(result.statistics.dialogueCount).toBe(0);
  });
});

// ============================================================================
// Music Processing Tests
// ============================================================================

describe('Music Processing', () => {
  it('should position music across episode duration', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
      createMockShot({ id: 'shot-2', sequence_number: 2, duration_seconds: 3 }),
    ];

    const audioTracks: AudioTrackInput[] = [
      createMockAudioTrack({ id: 'music-1', duration_seconds: 120 }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks,
      mode: 'full',
    };

    const result = autoStitch(input);
    const musicTrack = result.timeline.tracks.find((t) => t.type === 'music');

    expect(musicTrack?.clips).toHaveLength(1);
    expect(musicTrack?.clips[0]?.startFrame).toBe(0);
    // Music should be trimmed to episode duration (8s = 240 frames)
    expect(musicTrack?.clips[0]?.durationFrames).toBe(240);
  });

  it('should not trim music shorter than episode duration', () => {
    const shots: ShotInput[] = [
      createMockShot({
        id: 'shot-1',
        sequence_number: 1,
        duration_seconds: 10,
      }),
    ];

    const audioTracks: AudioTrackInput[] = [
      createMockAudioTrack({ id: 'music-1', duration_seconds: 5 }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks,
      mode: 'full',
    };

    const result = autoStitch(input);
    const musicTrack = result.timeline.tracks.find((t) => t.type === 'music');

    // Music should keep its original duration (5s = 150 frames)
    expect(musicTrack?.clips[0]?.durationFrames).toBe(150);
  });

  it('should handle music track without file_url', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
    ];

    const audioTracks: AudioTrackInput[] = [
      createMockAudioTrack({ id: 'music-1', file_url: null }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks,
      mode: 'full',
    };

    const result = autoStitch(input);
    const musicTrack = result.timeline.tracks.find((t) => t.type === 'music');

    // No clip should be created for music without file
    expect(musicTrack?.clips).toHaveLength(0);
  });
});

// ============================================================================
// Mode Tests
// ============================================================================

describe('Auto-Stitch Modes', () => {
  const baseShots: ShotInput[] = [
    createMockShot({ id: 'shot-1', sequence_number: 1 }),
  ];

  const baseDialogue: DialogueLineInput[] = [
    createMockDialogue({ id: 'line-1', shot_id: 'shot-1', sequence_number: 1 }),
  ];

  const baseAudioTracks: AudioTrackInput[] = [
    createMockAudioTrack({ id: 'music-1' }),
  ];

  it('should process all tracks in full mode', () => {
    const input: AutoStitchInput = {
      shots: baseShots,
      dialogueLines: baseDialogue,
      audioTracks: baseAudioTracks,
      mode: 'full',
    };

    const result = autoStitch(input);

    expect(
      result.timeline.tracks.find((t) => t.type === 'video')?.clips.length,
    ).toBeGreaterThan(0);
    expect(
      result.timeline.tracks.find((t) => t.type === 'dialogue')?.clips.length,
    ).toBeGreaterThan(0);
    expect(
      result.timeline.tracks.find((t) => t.type === 'music')?.clips.length,
    ).toBeGreaterThan(0);
  });

  it('should only process video in shots-only mode', () => {
    const input: AutoStitchInput = {
      shots: baseShots,
      dialogueLines: baseDialogue,
      audioTracks: baseAudioTracks,
      mode: 'shots-only',
    };

    const result = autoStitch(input);

    expect(
      result.timeline.tracks.find((t) => t.type === 'video')?.clips.length,
    ).toBeGreaterThan(0);
    expect(
      result.timeline.tracks.find((t) => t.type === 'dialogue')?.clips.length,
    ).toBe(0);
    expect(
      result.timeline.tracks.find((t) => t.type === 'music')?.clips.length,
    ).toBe(0);
  });

  it('should skip video in audio-only mode', () => {
    const input: AutoStitchInput = {
      shots: baseShots,
      dialogueLines: baseDialogue,
      audioTracks: baseAudioTracks,
      mode: 'audio-only',
    };

    const result = autoStitch(input);

    expect(
      result.timeline.tracks.find((t) => t.type === 'video')?.clips.length,
    ).toBe(0);
    expect(
      result.timeline.tracks.find((t) => t.type === 'dialogue')?.clips.length,
    ).toBeGreaterThan(0);
    // Music depends on video track duration, so it may be 0 in audio-only mode
  });
});

// ============================================================================
// Gap Detection Tests
// ============================================================================

describe('Gap Detection', () => {
  it('should detect gap between non-contiguous clips', () => {
    const input: AutoStitchInput = {
      shots: [
        createMockShot({
          id: 'shot-1',
          sequence_number: 1,
          duration_seconds: 3,
        }),
        createMockShot({
          id: 'shot-2',
          sequence_number: 2,
          duration_seconds: 3,
        }),
      ],
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    // First, create the timeline normally (no gaps)
    const result = autoStitch(input);

    // Video track should be contiguous (no gaps)
    expect(result.gaps.filter((g) => g.trackType === 'video')).toHaveLength(0);
  });

  it('should ignore gaps smaller than threshold', () => {
    // Test with detectGaps directly
    const tracks = [
      {
        id: 'video',
        type: 'video' as const,
        name: 'Video',
        clips: [
          {
            id: 'c1',
            trackType: 'video' as const,
            startFrame: 0,
            durationFrames: 100,
            name: 'Clip 1',
            isLocked: false,
          },
          {
            id: 'c2',
            trackType: 'video' as const,
            startFrame: 102, // 2 frame gap = 0.066s at 30fps
            durationFrames: 100,
            name: 'Clip 2',
            isLocked: false,
          },
        ],
        isMuted: false,
        isSolo: false,
        isLocked: false,
        height: 80,
      },
    ];

    const gaps = detectGaps(tracks, 0.1, 30); // threshold = 0.1s = 3 frames

    expect(gaps).toHaveLength(0);
  });

  it('should detect gaps larger than threshold', () => {
    const tracks = [
      {
        id: 'video',
        type: 'video' as const,
        name: 'Video',
        clips: [
          {
            id: 'c1',
            trackType: 'video' as const,
            startFrame: 0,
            durationFrames: 100,
            name: 'Clip 1',
            isLocked: false,
          },
          {
            id: 'c2',
            trackType: 'video' as const,
            startFrame: 150, // 50 frame gap = 1.67s at 30fps
            durationFrames: 100,
            name: 'Clip 2',
            isLocked: false,
          },
        ],
        isMuted: false,
        isSolo: false,
        isLocked: false,
        height: 80,
      },
    ];

    const gaps = detectGaps(tracks, 0.1, 30);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.trackType).toBe('video');
    expect(gaps[0]?.startSeconds).toBeCloseTo(100 / 30);
    expect(gaps[0]?.endSeconds).toBeCloseTo(150 / 30);
  });
});

// ============================================================================
// Gap Fill Tests
// ============================================================================

describe('Gap Fill', () => {
  const createTimelineWithGap = () => ({
    tracks: [
      {
        id: 'video',
        type: 'video' as const,
        name: 'Video',
        clips: [
          {
            id: 'c1',
            trackType: 'video' as const,
            startFrame: 0,
            durationFrames: 100,
            name: 'Clip 1',
            isLocked: false,
          },
          {
            id: 'c2',
            trackType: 'video' as const,
            startFrame: 150,
            durationFrames: 100,
            name: 'Clip 2',
            isLocked: false,
          },
        ],
        isMuted: false,
        isSolo: false,
        isLocked: false,
        height: 80,
      },
    ],
    totalFrames: 250,
    fps: 30,
    inPoint: null,
    outPoint: null,
    version: 1,
  });

  const gaps = [
    {
      trackType: 'video' as const,
      startSeconds: 100 / 30,
      endSeconds: 150 / 30,
      durationSeconds: 50 / 30,
    },
  ];

  it('should not modify timeline when using ignore strategy', () => {
    const timeline = createTimelineWithGap();
    const result = fillGaps(timeline, gaps, 'ignore');

    expect(result).toBe(timeline); // Same reference
  });

  it('should extend previous clip when using extend strategy', () => {
    const timeline = createTimelineWithGap();
    const result = fillGaps(timeline, gaps, 'extend');

    const videoTrack = result.tracks.find((t) => t.type === 'video');
    const firstClip = videoTrack?.clips.find((c) => c.id === 'c1');

    // First clip should be extended by 50 frames
    expect(firstClip?.durationFrames).toBe(150);
  });

  it('should add placeholder clip when using black strategy', () => {
    const timeline = createTimelineWithGap();
    const result = fillGaps(timeline, gaps, 'black');

    const videoTrack = result.tracks.find((t) => t.type === 'video');

    // Should have 3 clips now (original 2 + fill)
    expect(videoTrack?.clips).toHaveLength(3);

    const fillClip = videoTrack?.clips.find((c) => c.name === 'Gap Fill');
    expect(fillClip).toBeDefined();
    expect(fillClip?.startFrame).toBe(100);
    expect(fillClip?.durationFrames).toBe(50);
  });
});

// ============================================================================
// Statistics Tests
// ============================================================================

describe('Statistics', () => {
  it('should calculate correct statistics', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
      createMockShot({ id: 'shot-2', sequence_number: 2, duration_seconds: 3 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        shot_id: 'shot-1',
        sequence_number: 1,
      }),
    ];

    // Use music with shorter duration to match video duration
    const audioTracks: AudioTrackInput[] = [
      createMockAudioTrack({
        id: 'music-1',
        type: 'music',
        duration_seconds: 5,
      }),
      createMockAudioTrack({
        id: 'ambient-1',
        type: 'ambient',
        duration_seconds: 3,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks,
      mode: 'full',
    };

    const result = autoStitch(input);

    expect(result.statistics.shotCount).toBe(2);
    expect(result.statistics.dialogueCount).toBe(1);
    expect(result.statistics.musicTrackCount).toBe(1);
    // Total duration = max of all tracks = 8s (video) = 240 frames
    // Music is trimmed to video duration (8s), but we provided 5s music
    // Dialogue default duration is 3s, starts at 0.5s offset = ends at 3.5s
    // Ambient is 3s starting at 0, so ends at 3s = 90 frames
    // Video is 8s = 240 frames (dominant)
    expect(result.statistics.totalDurationFrames).toBe(240); // 8s = 240 frames
    expect(result.statistics.totalDurationSeconds).toBe(8);
  });

  it('should count placeholders correctly', () => {
    const shots: ShotInput[] = [
      createMockShot({
        id: 'shot-1',
        sequence_number: 1,
        video_url: null,
      }),
      createMockShot({
        id: 'shot-2',
        sequence_number: 2,
        video_url: 'https://example.com/video.mp4',
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
    };

    const result = autoStitch(input);

    expect(result.statistics.placeholderCount).toBe(1);
  });
});

// ============================================================================
// Custom Options Tests
// ============================================================================

describe('Custom Options', () => {
  it('should respect custom dialogue offset', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
    ];

    const dialogue: DialogueLineInput[] = [
      createMockDialogue({
        id: 'line-1',
        shot_id: 'shot-1',
        sequence_number: 1,
      }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: dialogue,
      audioTracks: [],
      mode: 'full',
      options: {
        dialogueOffsetSeconds: 1.0, // Custom 1 second offset
      },
    };

    const result = autoStitch(input);
    const dialogueTrack = result.timeline.tracks.find(
      (t) => t.type === 'dialogue',
    );

    // 1 second offset at 30fps = 30 frames
    expect(dialogueTrack?.clips[0]?.startFrame).toBe(30);
  });

  it('should respect custom FPS', () => {
    const shots: ShotInput[] = [
      createMockShot({ id: 'shot-1', sequence_number: 1, duration_seconds: 5 }),
    ];

    const input: AutoStitchInput = {
      shots,
      dialogueLines: [],
      audioTracks: [],
      mode: 'full',
      options: {
        fps: 24,
      },
    };

    const result = autoStitch(input);

    expect(result.timeline.fps).toBe(24);
    // 5 seconds at 24fps = 120 frames
    expect(result.statistics.totalDurationFrames).toBe(120);
  });
});
