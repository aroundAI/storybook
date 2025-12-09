/**
 * Timeline Converter Tests
 *
 * Tests for timeline to FFmpeg conversion functions.
 */

import { describe, expect, it } from 'vitest';
import {
  timelineToRenderRequest,
  generateRenderPlan,
} from '../src/lib/timeline/timeline-to-ffmpeg';
import {
  framesToSeconds,
  secondsToFrames,
  getClipDurationFrames,
  getClipSourceDurationFrames,
  clipsOverlap,
  sortClipsByStart,
  calculateTimelineDuration,
} from '../src/lib/timeline/timeline-types';
import type {
  TimelineProject,
  TimelineTrack,
  TimelineClip,
  TimelineExportSettings,
} from '../src/lib/timeline/timeline-types';

describe('Timeline Types - Helper Functions', () => {
  describe('framesToSeconds', () => {
    it('should convert frames to seconds at 30fps', () => {
      expect(framesToSeconds(30, 30)).toBe(1);
      expect(framesToSeconds(60, 30)).toBe(2);
      expect(framesToSeconds(15, 30)).toBe(0.5);
    });

    it('should convert frames to seconds at 24fps', () => {
      expect(framesToSeconds(24, 24)).toBe(1);
      expect(framesToSeconds(48, 24)).toBe(2);
    });

    it('should convert frames to seconds at 60fps', () => {
      expect(framesToSeconds(60, 60)).toBe(1);
      expect(framesToSeconds(30, 60)).toBe(0.5);
    });

    it('should handle zero frames', () => {
      expect(framesToSeconds(0, 30)).toBe(0);
    });
  });

  describe('secondsToFrames', () => {
    it('should convert seconds to frames at 30fps', () => {
      expect(secondsToFrames(1, 30)).toBe(30);
      expect(secondsToFrames(2, 30)).toBe(60);
      expect(secondsToFrames(0.5, 30)).toBe(15);
    });

    it('should round to nearest frame', () => {
      expect(secondsToFrames(1.1, 30)).toBe(33);
      expect(secondsToFrames(1.9, 30)).toBe(57);
    });

    it('should handle zero seconds', () => {
      expect(secondsToFrames(0, 30)).toBe(0);
    });
  });

  describe('getClipDurationFrames', () => {
    it('should calculate clip duration', () => {
      const clip: TimelineClip = {
        id: 'clip1',
        sourceId: 'source1',
        sourceUrl: '/path/to/video.mp4',
        sourceType: 'video',
        trackId: 'track1',
        startFrame: 0,
        endFrame: 150,
        inPoint: 0,
        outPoint: 150,
      };

      expect(getClipDurationFrames(clip)).toBe(150);
    });

    it('should handle clip starting mid-timeline', () => {
      const clip: TimelineClip = {
        id: 'clip1',
        sourceId: 'source1',
        sourceUrl: '/path/to/video.mp4',
        sourceType: 'video',
        trackId: 'track1',
        startFrame: 100,
        endFrame: 250,
        inPoint: 0,
        outPoint: 150,
      };

      expect(getClipDurationFrames(clip)).toBe(150);
    });
  });

  describe('getClipSourceDurationFrames', () => {
    it('should calculate source duration from in/out points', () => {
      const clip: TimelineClip = {
        id: 'clip1',
        sourceId: 'source1',
        sourceUrl: '/path/to/video.mp4',
        sourceType: 'video',
        trackId: 'track1',
        startFrame: 0,
        endFrame: 100,
        inPoint: 30,
        outPoint: 130,
      };

      expect(getClipSourceDurationFrames(clip)).toBe(100);
    });

    it('should handle in-point at 0', () => {
      const clip: TimelineClip = {
        id: 'clip1',
        sourceId: 'source1',
        sourceUrl: '/path/to/video.mp4',
        sourceType: 'video',
        trackId: 'track1',
        startFrame: 0,
        endFrame: 150,
        inPoint: 0,
        outPoint: 150,
      };

      expect(getClipSourceDurationFrames(clip)).toBe(150);
    });
  });

  describe('clipsOverlap', () => {
    const baseClip: TimelineClip = {
      id: 'clip1',
      sourceId: 'source1',
      sourceUrl: '/path/to/video.mp4',
      sourceType: 'video',
      trackId: 'track1',
      startFrame: 0,
      endFrame: 100,
      inPoint: 0,
      outPoint: 100,
    };

    it('should detect overlapping clips', () => {
      const clip1 = { ...baseClip, startFrame: 0, endFrame: 100 };
      const clip2 = { ...baseClip, id: 'clip2', startFrame: 50, endFrame: 150 };

      expect(clipsOverlap(clip1, clip2)).toBe(true);
    });

    it('should return false for non-overlapping clips', () => {
      const clip1 = { ...baseClip, startFrame: 0, endFrame: 100 };
      const clip2 = { ...baseClip, id: 'clip2', startFrame: 100, endFrame: 200 };

      expect(clipsOverlap(clip1, clip2)).toBe(false);
    });

    it('should return false for adjacent clips', () => {
      const clip1 = { ...baseClip, startFrame: 0, endFrame: 100 };
      const clip2 = { ...baseClip, id: 'clip2', startFrame: 100, endFrame: 200 };

      expect(clipsOverlap(clip1, clip2)).toBe(false);
    });

    it('should detect complete containment', () => {
      const clip1 = { ...baseClip, startFrame: 0, endFrame: 200 };
      const clip2 = { ...baseClip, id: 'clip2', startFrame: 50, endFrame: 150 };

      expect(clipsOverlap(clip1, clip2)).toBe(true);
    });
  });

  describe('sortClipsByStart', () => {
    it('should sort clips by start frame', () => {
      const clips: TimelineClip[] = [
        {
          id: 'clip3',
          sourceId: 'source3',
          sourceUrl: '/path/to/video3.mp4',
          sourceType: 'video',
          trackId: 'track1',
          startFrame: 200,
          endFrame: 300,
          inPoint: 0,
          outPoint: 100,
        },
        {
          id: 'clip1',
          sourceId: 'source1',
          sourceUrl: '/path/to/video1.mp4',
          sourceType: 'video',
          trackId: 'track1',
          startFrame: 0,
          endFrame: 100,
          inPoint: 0,
          outPoint: 100,
        },
        {
          id: 'clip2',
          sourceId: 'source2',
          sourceUrl: '/path/to/video2.mp4',
          sourceType: 'video',
          trackId: 'track1',
          startFrame: 100,
          endFrame: 200,
          inPoint: 0,
          outPoint: 100,
        },
      ];

      const sorted = sortClipsByStart(clips);

      expect(sorted[0].id).toBe('clip1');
      expect(sorted[1].id).toBe('clip2');
      expect(sorted[2].id).toBe('clip3');
    });

    it('should not mutate original array', () => {
      const clips: TimelineClip[] = [
        {
          id: 'clip2',
          sourceId: 'source2',
          sourceUrl: '/path/to/video2.mp4',
          sourceType: 'video',
          trackId: 'track1',
          startFrame: 100,
          endFrame: 200,
          inPoint: 0,
          outPoint: 100,
        },
        {
          id: 'clip1',
          sourceId: 'source1',
          sourceUrl: '/path/to/video1.mp4',
          sourceType: 'video',
          trackId: 'track1',
          startFrame: 0,
          endFrame: 100,
          inPoint: 0,
          outPoint: 100,
        },
      ];

      sortClipsByStart(clips);

      expect(clips[0].id).toBe('clip2'); // Original order preserved
    });

    it('should handle empty array', () => {
      const sorted = sortClipsByStart([]);
      expect(sorted).toEqual([]);
    });
  });

  describe('calculateTimelineDuration', () => {
    it('should calculate max end frame across all tracks', () => {
      const tracks: TimelineTrack[] = [
        {
          id: 'track1',
          type: 'video',
          name: 'Video Track',
          order: 0,
          clips: [
            {
              id: 'clip1',
              sourceId: 'source1',
              sourceUrl: '/path/to/video1.mp4',
              sourceType: 'video',
              trackId: 'track1',
              startFrame: 0,
              endFrame: 100,
              inPoint: 0,
              outPoint: 100,
            },
          ],
        },
        {
          id: 'track2',
          type: 'audio',
          name: 'Audio Track',
          order: 1,
          clips: [
            {
              id: 'audio1',
              sourceId: 'audio-source1',
              sourceUrl: '/path/to/audio.mp3',
              sourceType: 'audio',
              trackId: 'track2',
              startFrame: 0,
              endFrame: 150,
              inPoint: 0,
              outPoint: 150,
            },
          ],
        },
      ];

      expect(calculateTimelineDuration(tracks)).toBe(150);
    });

    it('should return 0 for empty tracks', () => {
      const tracks: TimelineTrack[] = [
        {
          id: 'track1',
          type: 'video',
          name: 'Video Track',
          order: 0,
          clips: [],
        },
      ];

      expect(calculateTimelineDuration(tracks)).toBe(0);
    });

    it('should return 0 for no tracks', () => {
      expect(calculateTimelineDuration([])).toBe(0);
    });
  });
});

describe('Timeline to FFmpeg Converter', () => {
  // Test fixtures
  const mockExportSettings: TimelineExportSettings = {
    format: 'mp4',
    resolution: '1080p',
    quality: 'standard',
    frameRate: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 192,
  };

  const createMockProject = (overrides: Partial<TimelineProject> = {}): TimelineProject => ({
    id: 'project1',
    name: 'Test Project',
    durationFrames: 300,
    frameRate: 30,
    resolution: { width: 1920, height: 1080 },
    tracks: [
      {
        id: 'track1',
        type: 'video',
        name: 'Video Track 1',
        order: 0,
        clips: [
          {
            id: 'clip1',
            sourceId: 'source1',
            sourceUrl: '/path/to/video1.mp4',
            sourceType: 'video',
            trackId: 'track1',
            startFrame: 0,
            endFrame: 150,
            inPoint: 0,
            outPoint: 150,
          },
          {
            id: 'clip2',
            sourceId: 'source2',
            sourceUrl: '/path/to/video2.mp4',
            sourceType: 'video',
            trackId: 'track1',
            startFrame: 150,
            endFrame: 300,
            inPoint: 0,
            outPoint: 150,
          },
        ],
      },
    ],
    ...overrides,
  });

  describe('timelineToRenderRequest', () => {
    it('should convert timeline to render request', () => {
      const project = createMockProject();
      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.id).toBe('project1');
      expect(result.shots).toHaveLength(2);
      expect(result.outputFormat).toBe('mp4');
      expect(result.resolution).toBe('1080p');
      expect(result.quality).toBe('standard');
    });

    it('should convert clips to VideoClip format', () => {
      const project = createMockProject();
      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.shots[0].sourceUrl).toBe('/path/to/video1.mp4');
      expect(result.shots[0].duration).toBe(5); // 150 frames at 30fps
      expect(result.shots[1].sourceUrl).toBe('/path/to/video2.mp4');
    });

    it('should filter out hidden video tracks', () => {
      const project = createMockProject({
        tracks: [
          {
            id: 'track1',
            type: 'video',
            name: 'Video Track 1',
            order: 0,
            visible: false, // Hidden
            clips: [
              {
                id: 'clip1',
                sourceId: 'source1',
                sourceUrl: '/path/to/hidden.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 0,
                endFrame: 150,
                inPoint: 0,
                outPoint: 150,
              },
            ],
          },
          {
            id: 'track2',
            type: 'video',
            name: 'Video Track 2',
            order: 1,
            visible: true,
            clips: [
              {
                id: 'clip2',
                sourceId: 'source2',
                sourceUrl: '/path/to/visible.mp4',
                sourceType: 'video',
                trackId: 'track2',
                startFrame: 0,
                endFrame: 150,
                inPoint: 0,
                outPoint: 150,
              },
            ],
          },
        ],
      });

      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.shots).toHaveLength(1);
      expect(result.shots[0].sourceUrl).toBe('/path/to/visible.mp4');
    });

    it('should filter out muted audio tracks', () => {
      const project = createMockProject({
        tracks: [
          ...createMockProject().tracks,
          {
            id: 'audio1',
            type: 'audio',
            name: 'Audio Track',
            order: 1,
            muted: true,
            clips: [
              {
                id: 'audio-clip',
                sourceId: 'audio-source',
                sourceUrl: '/path/to/music.mp3',
                sourceType: 'audio',
                trackId: 'audio1',
                startFrame: 0,
                endFrame: 300,
                inPoint: 0,
                outPoint: 300,
              },
            ],
          },
        ],
      });

      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.audioTracks).toBeUndefined();
    });

    it('should include unmuted audio tracks', () => {
      const project = createMockProject({
        tracks: [
          ...createMockProject().tracks,
          {
            id: 'audio1',
            type: 'audio',
            name: 'Audio Track',
            order: 1,
            muted: false,
            volume: 0.5,
            clips: [
              {
                id: 'audio-clip',
                sourceId: 'audio-source',
                sourceUrl: '/path/to/music.mp3',
                sourceType: 'audio',
                trackId: 'audio1',
                startFrame: 0,
                endFrame: 300,
                inPoint: 0,
                outPoint: 300,
              },
            ],
          },
        ],
      });

      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.audioTracks).toHaveLength(1);
      expect(result.audioTracks![0].sourceUrl).toBe('/path/to/music.mp3');
    });

    it('should extract transitions from clips', () => {
      const project = createMockProject({
        tracks: [
          {
            id: 'track1',
            type: 'video',
            name: 'Video Track 1',
            order: 0,
            clips: [
              {
                id: 'clip1',
                sourceId: 'source1',
                sourceUrl: '/path/to/video1.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 0,
                endFrame: 150,
                inPoint: 0,
                outPoint: 150,
              },
              {
                id: 'clip2',
                sourceId: 'source2',
                sourceUrl: '/path/to/video2.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 150,
                endFrame: 300,
                inPoint: 0,
                outPoint: 150,
                transitionIn: {
                  type: 'crossfade',
                  durationFrames: 15,
                },
              },
            ],
          },
        ],
      });

      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.transitions).toBeDefined();
      // First clip has no transition, second clip has crossfade transition
      // The converter adds a 'cut' for the first clip and extracts transitionIn for the second
      expect(result.transitions!.length).toBeGreaterThanOrEqual(1);
      // Find the crossfade transition
      const crossfadeTransition = result.transitions!.find(t => t.type === 'crossfade');
      expect(crossfadeTransition).toBeDefined();
      expect(crossfadeTransition!.duration).toBe(0.5); // 15 frames at 30fps
    });

    it('should handle custom resolution fallback', () => {
      const customSettings: TimelineExportSettings = {
        ...mockExportSettings,
        resolution: 'custom',
        customResolution: { width: 1920, height: 1080 },
      };

      const project = createMockProject();
      const result = timelineToRenderRequest(project, customSettings);

      // Should fallback to 1080p when custom is specified
      expect(result.resolution).toBe('1080p');
    });

    it('should pass through codec settings', () => {
      const project = createMockProject();
      const result = timelineToRenderRequest(project, mockExportSettings);

      expect(result.videoCodec).toBe('h264');
      expect(result.audioCodec).toBe('aac');
      expect(result.framerate).toBe(30);
    });
  });

  describe('generateRenderPlan', () => {
    it('should generate render plan with inputs', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.inputs).toHaveLength(2);
      expect(result.inputs).toContain('/path/to/video1.mp4');
      expect(result.inputs).toContain('/path/to/video2.mp4');
    });

    it('should deduplicate source files', () => {
      const project = createMockProject({
        tracks: [
          {
            id: 'track1',
            type: 'video',
            name: 'Video Track 1',
            order: 0,
            clips: [
              {
                id: 'clip1',
                sourceId: 'source1',
                sourceUrl: '/path/to/video1.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 0,
                endFrame: 150,
                inPoint: 0,
                outPoint: 150,
              },
              {
                id: 'clip2',
                sourceId: 'source1', // Same source used again
                sourceUrl: '/path/to/video1.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 150,
                endFrame: 300,
                inPoint: 150,
                outPoint: 300,
              },
            ],
          },
        ],
      });

      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.inputs).toHaveLength(1);
      expect(result.inputs[0]).toBe('/path/to/video1.mp4');
    });

    it('should generate filter graph', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.filterGraph).toBeDefined();
      expect(result.filterGraph.length).toBeGreaterThan(0);
    });

    it('should include trim filters for clips', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.filterGraph).toContain('trim=');
      expect(result.filterGraph).toContain('setpts=PTS-STARTPTS');
    });

    it('should include concat for multiple clips', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.filterGraph).toContain('concat=n=2');
      expect(result.filterGraph).toContain('[outv]');
    });

    it('should generate output options', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.outputOptions).toContain('-c:v');
      expect(result.outputOptions).toContain('libx264');
      expect(result.outputOptions).toContain('-preset');
      expect(result.outputOptions).toContain('medium');
    });

    it('should include faststart for mp4', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.outputOptions).toContain('-movflags');
      expect(result.outputOptions).toContain('+faststart');
    });

    it('should calculate output duration', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.outputDuration).toBe(10); // 300 frames at 30fps
    });

    it('should estimate render time', () => {
      const project = createMockProject();
      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.estimatedDuration).toBeGreaterThan(0);
    });

    it('should handle audio tracks', () => {
      const project = createMockProject({
        tracks: [
          ...createMockProject().tracks,
          {
            id: 'audio1',
            type: 'audio',
            name: 'Audio Track',
            order: 1,
            clips: [
              {
                id: 'audio-clip',
                sourceId: 'audio-source',
                sourceUrl: '/path/to/music.mp3',
                sourceType: 'audio',
                trackId: 'audio1',
                startFrame: 0,
                endFrame: 300,
                inPoint: 0,
                outPoint: 300,
              },
            ],
          },
        ],
      });

      const result = generateRenderPlan(project, mockExportSettings);

      expect(result.inputs).toContain('/path/to/music.mp3');
      expect(result.filterGraph).toContain('[outa]');
    });

    it('should apply quality presets', () => {
      const project = createMockProject();

      const draftResult = generateRenderPlan(project, {
        ...mockExportSettings,
        quality: 'draft',
      });
      expect(draftResult.outputOptions).toContain('ultrafast');
      expect(draftResult.outputOptions).toContain('-crf');
      expect(draftResult.outputOptions).toContain('28');

      const highResult = generateRenderPlan(project, {
        ...mockExportSettings,
        quality: 'high',
      });
      expect(highResult.outputOptions).toContain('slow');
      expect(highResult.outputOptions).toContain('18');
    });

    it('should apply resolution scaling', () => {
      const project = createMockProject();

      const result720p = generateRenderPlan(project, {
        ...mockExportSettings,
        resolution: '720p',
      });
      expect(result720p.outputOptions.join(' ')).toContain('1280:720');

      const result4k = generateRenderPlan(project, {
        ...mockExportSettings,
        resolution: '4k',
      });
      expect(result4k.outputOptions.join(' ')).toContain('3840:2160');
    });

    it('should handle single clip without concat', () => {
      const project = createMockProject({
        tracks: [
          {
            id: 'track1',
            type: 'video',
            name: 'Video Track 1',
            order: 0,
            clips: [
              {
                id: 'clip1',
                sourceId: 'source1',
                sourceUrl: '/path/to/video1.mp4',
                sourceType: 'video',
                trackId: 'track1',
                startFrame: 0,
                endFrame: 150,
                inPoint: 0,
                outPoint: 150,
              },
            ],
          },
        ],
      });

      const result = generateRenderPlan(project, mockExportSettings);

      // Single clip should use null filter instead of concat (FFmpeg doesn't have a 'copy' video filter)
      expect(result.filterGraph).toContain('null[outv]');
    });
  });
});
