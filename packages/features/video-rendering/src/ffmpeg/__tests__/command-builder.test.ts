import { describe, expect, it } from 'vitest';

import type { Clip, Timeline } from '../../schema/timeline';
import {
  buildConcatDemuxerCommand,
  buildFFmpegCommand,
  commandToArgs,
  commandToString,
} from '../command-builder';
import {
  generateConcatDemuxerContent,
  validateConcatContent,
} from '../concat-demuxer';
import { buildXfadeFilter, mapTransitionToXfade } from '../transitions';

// ============================================================================
// Test Data
// ============================================================================

const createTestClip = (
  id: string,
  startTime: number,
  duration: number,
  url = 'https://example.com/video.mp4',
): Clip => ({
  id,
  trackId: 'video',
  assetUrl: url,
  name: `Clip ${id}`,
  startTime,
  duration,
  volume: 1,
  isPlaceholder: false,
});

const createTestTimeline = (options?: Partial<Timeline>): Timeline => ({
  id: 'test-timeline-001',
  version: '1.0',
  duration: 30,
  tracks: [
    {
      id: 'video',
      type: 'video',
      name: 'Video',
      clips: [
        createTestClip('clip-1', 0, 10, 'https://example.com/clip1.mp4'),
        createTestClip('clip-2', 10, 10, 'https://example.com/clip2.mp4'),
        createTestClip('clip-3', 20, 10, 'https://example.com/clip3.mp4'),
      ],
      volume: 1,
      isMuted: false,
      isLocked: false,
    },
  ],
  transitions: [],
  renderSettings: {
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    audioCodec: 'aac',
    format: 'mp4',
    quality: 'standard',
    audioBitrate: 192,
    sampleRate: 48000,
    includeAudio: true,
  },
  ...options,
});

// ============================================================================
// Command Builder Tests
// ============================================================================

describe('FFmpeg Command Builder', () => {
  describe('buildFFmpegCommand', () => {
    it('should build a basic command for simple timeline', () => {
      const timeline = createTestTimeline();
      const command = buildFFmpegCommand(timeline, '/output/video.mp4');

      expect(command).toBeDefined();
      expect(command.outputPath).toBe('/output/video.mp4');
      expect(command.inputs.length).toBeGreaterThan(0);
    });

    it('should include global options', () => {
      const timeline = createTestTimeline();
      const command = buildFFmpegCommand(timeline, '/output/video.mp4', {
        overwrite: true,
        threads: 4,
      });

      expect(command.globalOptions).toContain('-y');
      expect(command.globalOptions).toContain('-hide_banner');
    });

    it('should build filter_complex when transitions exist', () => {
      const timeline = createTestTimeline({
        transitions: [
          {
            id: 'trans-1',
            type: 'crossfade',
            clipBeforeId: 'clip-1',
            clipAfterId: 'clip-2',
            duration: 1,
          },
        ],
      });
      const command = buildFFmpegCommand(timeline, '/output/video.mp4');

      expect(command.filterComplex).toBeDefined();
    });
  });

  describe('commandToString', () => {
    it('should convert command to string', () => {
      const timeline = createTestTimeline();
      const command = buildFFmpegCommand(timeline, '/output/video.mp4');
      const str = commandToString(command);

      expect(str).toContain('ffmpeg');
      expect(str).toContain('-i');
      expect(str).toContain('/output/video.mp4');
    });

    it('should use custom ffmpeg path', () => {
      const timeline = createTestTimeline();
      const command = buildFFmpegCommand(timeline, '/output/video.mp4');
      const str = commandToString(command, '/usr/local/bin/ffmpeg');

      expect(str).toContain('/usr/local/bin/ffmpeg');
    });
  });

  describe('commandToArgs', () => {
    it('should convert command to array of arguments', () => {
      const timeline = createTestTimeline();
      const command = buildFFmpegCommand(timeline, '/output/video.mp4');
      const args = commandToArgs(command);

      expect(Array.isArray(args)).toBe(true);
      expect(args.length).toBeGreaterThan(0);
      expect(args[args.length - 1]).toBe('/output/video.mp4');
    });
  });
});

// ============================================================================
// Concat Demuxer Tests
// ============================================================================

describe('Concat Demuxer', () => {
  describe('generateConcatDemuxerContent', () => {
    it('should generate valid concat demuxer content', () => {
      const clips = [
        createTestClip('1', 0, 5, '/video/clip1.mp4'),
        createTestClip('2', 5, 5, '/video/clip2.mp4'),
      ];
      const content = generateConcatDemuxerContent(clips);

      expect(content).toContain('ffconcat version 1.0');
      expect(content).toContain("file '/video/clip1.mp4'");
      expect(content).toContain("file '/video/clip2.mp4'");
    });

    it('should include duration when option is set', () => {
      const clips = [createTestClip('1', 0, 5, '/video/clip1.mp4')];
      const content = generateConcatDemuxerContent(clips, {
        includeDuration: true,
      });

      expect(content).toContain('duration 5');
    });

    it('should include inpoint and outpoint for trimmed clips', () => {
      const clips: Clip[] = [
        {
          ...createTestClip('1', 0, 5, '/video/clip1.mp4'),
          sourceStart: 2,
          sourceEnd: 7,
        },
      ];
      const content = generateConcatDemuxerContent(clips);

      expect(content).toContain('inpoint 2');
      expect(content).toContain('outpoint 7');
    });

    it('should escape single quotes in paths', () => {
      const clips = [createTestClip('1', 0, 5, "/video/clip's.mp4")];
      const content = generateConcatDemuxerContent(clips);

      expect(content).toContain("'\\''");
    });

    it('should skip placeholder clips', () => {
      const clips: Clip[] = [
        {
          ...createTestClip('1', 0, 5, '/video/clip1.mp4'),
          isPlaceholder: true,
        },
        createTestClip('2', 5, 5, '/video/clip2.mp4'),
      ];
      const content = generateConcatDemuxerContent(clips);

      expect(content).not.toContain('clip1.mp4');
      expect(content).toContain('clip2.mp4');
    });
  });

  describe('validateConcatContent', () => {
    it('should validate correct concat content', () => {
      const content = `ffconcat version 1.0

file '/video/clip1.mp4'
duration 5
`;
      const result = validateConcatContent(content);

      expect(result.valid).toBe(true);
      expect(result.entries).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing header', () => {
      const content = `file '/video/clip1.mp4'`;
      const result = validateConcatContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid duration', () => {
      const content = `ffconcat version 1.0

file '/video/clip1.mp4'
duration -5
`;
      const result = validateConcatContent(content);

      expect(result.valid).toBe(false);
    });
  });
});

// ============================================================================
// Transition Tests
// ============================================================================

describe('Transitions', () => {
  describe('mapTransitionToXfade', () => {
    it('should map fade transition', () => {
      const params = mapTransitionToXfade({
        type: 'fade',
        duration: 1,
      });

      expect(params.transition).toBe('fade');
      expect(params.duration).toBe(1);
    });

    it('should map crossfade transition', () => {
      const params = mapTransitionToXfade({
        type: 'crossfade',
        duration: 0.5,
      });

      expect(params.transition).toBe('fade');
      expect(params.duration).toBe(0.5);
    });

    it('should map wipe transition with direction', () => {
      const params = mapTransitionToXfade({
        type: 'wipe',
        duration: 1,
        direction: 'left',
      });

      expect(params.transition).toBe('wipeleft');
    });

    it('should map slide transition with direction', () => {
      const params = mapTransitionToXfade({
        type: 'slide',
        duration: 1,
        direction: 'up',
      });

      expect(params.transition).toBe('slideup');
    });

    it('should handle cut transition with zero duration', () => {
      const params = mapTransitionToXfade({
        type: 'cut',
        duration: 0,
      });

      expect(params.duration).toBe(0);
    });
  });

  describe('buildXfadeFilter', () => {
    it('should build correct filter string', () => {
      const params = { transition: 'fade', duration: 1, offset: 5 };
      const filter = buildXfadeFilter('v0', 'v1', params, 'vout');

      expect(filter).toContain('[v0][v1]xfade');
      expect(filter).toContain('transition=fade');
      expect(filter).toContain('duration=1');
      expect(filter).toContain('offset=5');
      expect(filter).toContain('[vout]');
    });

    it('should omit offset if zero', () => {
      const params = { transition: 'fade', duration: 1, offset: 0 };
      const filter = buildXfadeFilter('v0', 'v1', params, 'vout');

      expect(filter).not.toContain('offset=');
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('should generate complete command for complex timeline', () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'video',
          type: 'video',
          name: 'Video',
          clips: [
            createTestClip('clip-1', 0, 10, 'https://example.com/clip1.mp4'),
            createTestClip('clip-2', 9, 10, 'https://example.com/clip2.mp4'),
          ],
          volume: 1,
          isMuted: false,
          isLocked: false,
        },
        {
          id: 'music',
          type: 'music',
          name: 'Music',
          clips: [
            {
              id: 'music-1',
              trackId: 'music',
              assetUrl: 'https://example.com/music.mp3',
              name: 'Background Music',
              startTime: 0,
              duration: 20,
              volume: 0.3,
              fadeIn: 2,
              fadeOut: 2,
              isPlaceholder: false,
            },
          ],
          volume: 0.3,
          isMuted: false,
          isLocked: false,
        },
      ],
      transitions: [
        {
          id: 'trans-1',
          type: 'crossfade',
          clipBeforeId: 'clip-1',
          clipAfterId: 'clip-2',
          duration: 1,
        },
      ],
      duration: 19,
    });

    const command = buildFFmpegCommand(timeline, '/output/final.mp4', {
      threads: 4,
      hwaccel: 'none',
    });

    expect(command.filterComplex).toBeDefined();
    expect(command.inputs.length).toBe(3); // 2 video + 1 audio
    expect(command.outputPath).toBe('/output/final.mp4');

    const cmdString = commandToString(command);
    expect(cmdString).toContain('ffmpeg');
    expect(cmdString).toContain('-filter_complex');
  });
});
