/**
 * FFmpeg Command Builder Tests
 *
 * Tests for FFmpeg command generation functions.
 */

import { describe, expect, it } from 'vitest';
import {
  buildConcatCommand,
  buildTransitionCommand,
  buildAudioMixCommand,
  buildCompleteRenderCommand,
  buildProbeCommand,
  buildThumbnailCommand,
  estimateRenderTime,
} from '../src/lib/ffmpeg/command-builder';
import type { VideoClip, AudioClip, Transition, RenderRequest } from '../src/lib/types';

describe('FFmpeg Command Builder', () => {
  // Test fixtures
  const mockVideoClips: VideoClip[] = [
    {
      id: 'clip1',
      sourceUrl: '/path/to/video1.mp4',
      duration: 5,
      startTime: 0,
    },
    {
      id: 'clip2',
      sourceUrl: '/path/to/video2.mp4',
      duration: 5,
      startTime: 5,
    },
    {
      id: 'clip3',
      sourceUrl: '/path/to/video3.mp4',
      duration: 5,
      startTime: 10,
    },
  ];

  const mockTransitions: Transition[] = [
    { type: 'crossfade', duration: 0.5 },
    { type: 'dissolve', duration: 0.5 },
  ];

  const mockAudioTracks: AudioClip[] = [
    {
      id: 'audio1',
      sourceUrl: '/path/to/music.mp3',
      startTime: 0,
      duration: 15,
      volume: 0.3,
      fadeIn: 1,
      fadeOut: 2,
    },
  ];

  describe('buildConcatCommand', () => {
    it('should build a basic concatenation command', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4');

      expect(result.inputs).toHaveLength(3);
      expect(result.inputs[0]).toContain('video1.mp4');
      expect(result.inputs[1]).toContain('video2.mp4');
      expect(result.inputs[2]).toContain('video3.mp4');
    });

    it('should include filter_complex for concatenation', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4');

      expect(result.filterComplex).toContain('concat=n=3:v=1:a=1');
      expect(result.filterComplex).toContain('[0:v][0:a]');
      expect(result.filterComplex).toContain('[1:v][1:a]');
      expect(result.filterComplex).toContain('[2:v][2:a]');
      expect(result.filterComplex).toContain('[outv][outa]');
    });

    it('should include proper output mapping', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4');

      expect(result.outputArgs).toContain('-map "[outv]"');
      expect(result.outputArgs).toContain('-map "[outa]"');
    });

    it('should use default 1080p resolution', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4');

      expect(result.fullCommand).toContain('1920:1080');
    });

    it('should use specified resolution', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4', {
        resolution: '720p',
      });

      expect(result.fullCommand).toContain('1280:720');
    });

    it('should use 4K resolution when specified', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4', {
        resolution: '4k',
      });

      expect(result.fullCommand).toContain('3840:2160');
    });

    it('should include faststart for web playback', () => {
      const result = buildConcatCommand(mockVideoClips, '/output/result.mp4');

      expect(result.fullCommand).toContain('-movflags +faststart');
    });

    it('should apply quality preset settings', () => {
      const draftResult = buildConcatCommand(mockVideoClips, '/output/result.mp4', {
        quality: 'draft',
      });
      expect(draftResult.fullCommand).toContain('-preset ultrafast');
      expect(draftResult.fullCommand).toContain('-crf 28');

      const highResult = buildConcatCommand(mockVideoClips, '/output/result.mp4', {
        quality: 'high',
      });
      expect(highResult.fullCommand).toContain('-preset slow');
      expect(highResult.fullCommand).toContain('-crf 18');
    });

    it('should handle single clip', () => {
      const singleClip = [mockVideoClips[0]];
      const result = buildConcatCommand(singleClip, '/output/result.mp4');

      expect(result.inputs).toHaveLength(1);
      expect(result.filterComplex).toContain('concat=n=1');
    });
  });

  describe('buildTransitionCommand', () => {
    it('should fall back to concat for single clip', () => {
      const singleClip = [mockVideoClips[0]];
      const result = buildTransitionCommand(singleClip, [], '/output/result.mp4');

      expect(result.filterComplex).toContain('concat=n=1');
    });

    it('should build xfade transitions between clips', () => {
      const result = buildTransitionCommand(
        mockVideoClips.slice(0, 2),
        [mockTransitions[0]],
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('xfade');
      expect(result.filterComplex).toContain('transition=fade');
      expect(result.filterComplex).toContain('duration=0.5');
    });

    it('should include audio crossfade', () => {
      const result = buildTransitionCommand(
        mockVideoClips.slice(0, 2),
        [mockTransitions[0]],
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('acrossfade');
      expect(result.filterComplex).toContain('d=0.5');
    });

    it('should chain multiple transitions', () => {
      const result = buildTransitionCommand(
        mockVideoClips,
        mockTransitions,
        '/output/result.mp4'
      );

      // Should have video transitions
      expect(result.filterComplex).toContain('[outv]');
      expect(result.filterComplex).toContain('[outa]');
    });

    it('should use default transition when not specified', () => {
      const result = buildTransitionCommand(
        mockVideoClips.slice(0, 2),
        [], // No transitions specified
        '/output/result.mp4'
      );

      // Should use default crossfade
      expect(result.filterComplex).toContain('xfade');
    });

    it('should calculate correct offset based on clip duration', () => {
      const clips = [
        { ...mockVideoClips[0], duration: 5 },
        { ...mockVideoClips[1], duration: 5 },
      ];
      const transitions = [{ type: 'crossfade' as const, duration: 1 }];

      const result = buildTransitionCommand(clips, transitions, '/output/result.mp4');

      // Offset should be clip duration minus transition duration = 5 - 1 = 4
      expect(result.filterComplex).toContain('offset=4');
    });
  });

  describe('buildAudioMixCommand', () => {
    it('should include video and audio inputs', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 2),
        mockAudioTracks,
        '/output/result.mp4'
      );

      expect(result.inputs).toHaveLength(3); // 2 videos + 1 audio
      expect(result.inputs[2]).toContain('music.mp3');
    });

    it('should concatenate video clips', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 2),
        mockAudioTracks,
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('[0:v]');
      expect(result.filterComplex).toContain('[1:v]');
      expect(result.filterComplex).toContain('concat=n=2');
    });

    it('should apply volume to background audio', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 1),
        mockAudioTracks,
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('volume=0.3');
    });

    it('should apply fade in to audio', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 1),
        mockAudioTracks,
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('afade=t=in:st=0:d=1');
    });

    it('should apply fade out to audio', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 1),
        mockAudioTracks,
        '/output/result.mp4'
      );

      // Fade out starts at duration - fadeOut = 15 - 2 = 13
      expect(result.filterComplex).toContain('afade=t=out:st=13:d=2');
    });

    it('should mix all audio streams', () => {
      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 2),
        mockAudioTracks,
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('amix=inputs=2');
      expect(result.filterComplex).toContain('duration=first');
    });

    it('should handle delay for audio starting after 0', () => {
      const delayedAudio: AudioClip[] = [
        {
          ...mockAudioTracks[0],
          startTime: 5,
        },
      ];

      const result = buildAudioMixCommand(
        mockVideoClips.slice(0, 1),
        delayedAudio,
        '/output/result.mp4'
      );

      expect(result.filterComplex).toContain('adelay=5000|5000');
    });
  });

  describe('buildCompleteRenderCommand', () => {
    it('should use audio mix command when audio tracks present', () => {
      const request: RenderRequest = {
        id: 'render1',
        shots: mockVideoClips.slice(0, 2),
        audioTracks: mockAudioTracks,
        resolution: '1080p',
        quality: 'standard',
        outputFormat: 'mp4',
      };

      const result = buildCompleteRenderCommand(request, '/output/result.mp4');

      expect(result.filterComplex).toContain('amix');
    });

    it('should use transition command when transitions present', () => {
      const request: RenderRequest = {
        id: 'render1',
        shots: mockVideoClips.slice(0, 2),
        transitions: mockTransitions,
        resolution: '1080p',
        quality: 'standard',
        outputFormat: 'mp4',
      };

      const result = buildCompleteRenderCommand(request, '/output/result.mp4');

      expect(result.filterComplex).toContain('xfade');
    });

    it('should use concat command when no audio or transitions', () => {
      const request: RenderRequest = {
        id: 'render1',
        shots: mockVideoClips,
        resolution: '1080p',
        quality: 'standard',
        outputFormat: 'mp4',
      };

      const result = buildCompleteRenderCommand(request, '/output/result.mp4');

      expect(result.filterComplex).toContain('concat=n=3');
      expect(result.filterComplex).not.toContain('xfade');
      expect(result.filterComplex).not.toContain('amix');
    });
  });

  describe('buildProbeCommand', () => {
    it('should generate ffprobe command with JSON output', () => {
      const result = buildProbeCommand('/path/to/video.mp4');

      expect(result).toContain('ffprobe');
      expect(result).toContain('-print_format json');
      expect(result).toContain('-show_format');
      expect(result).toContain('-show_streams');
      expect(result).toContain('/path/to/video.mp4');
    });

    it('should use quiet mode', () => {
      const result = buildProbeCommand('/path/to/video.mp4');

      expect(result).toContain('-v quiet');
    });
  });

  describe('buildThumbnailCommand', () => {
    it('should generate thumbnail extraction command', () => {
      const result = buildThumbnailCommand('/path/to/video.mp4', '/output/thumb.jpg');

      expect(result).toContain('ffmpeg');
      expect(result).toContain('-vframes 1');
      expect(result).toContain('/path/to/video.mp4');
      expect(result).toContain('/output/thumb.jpg');
    });

    it('should use default timestamp of 0', () => {
      const result = buildThumbnailCommand('/path/to/video.mp4', '/output/thumb.jpg');

      expect(result).toContain('-ss 0');
    });

    it('should use specified timestamp', () => {
      const result = buildThumbnailCommand('/path/to/video.mp4', '/output/thumb.jpg', 5);

      expect(result).toContain('-ss 5');
    });

    it('should include quality flag', () => {
      const result = buildThumbnailCommand('/path/to/video.mp4', '/output/thumb.jpg');

      expect(result).toContain('-q:v 2');
    });
  });

  describe('estimateRenderTime', () => {
    it('should return time in milliseconds', () => {
      const result = estimateRenderTime(60, '1080p', 'standard');

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should increase for higher resolution', () => {
      const time720p = estimateRenderTime(60, '720p', 'standard');
      const time1080p = estimateRenderTime(60, '1080p', 'standard');
      const time4k = estimateRenderTime(60, '4k', 'standard');

      expect(time1080p).toBeGreaterThan(time720p);
      expect(time4k).toBeGreaterThan(time1080p);
    });

    it('should increase for higher quality', () => {
      const timeDraft = estimateRenderTime(60, '1080p', 'draft');
      const timeStandard = estimateRenderTime(60, '1080p', 'standard');
      const timeHigh = estimateRenderTime(60, '1080p', 'high');

      expect(timeStandard).toBeGreaterThan(timeDraft);
      expect(timeHigh).toBeGreaterThan(timeStandard);
    });

    it('should scale with duration', () => {
      const time30s = estimateRenderTime(30, '1080p', 'standard');
      const time60s = estimateRenderTime(60, '1080p', 'standard');

      expect(time60s).toBe(time30s * 2);
    });

    it('should return rounded integer', () => {
      const result = estimateRenderTime(33, '720p', 'draft');

      expect(Number.isInteger(result)).toBe(true);
    });
  });
});
