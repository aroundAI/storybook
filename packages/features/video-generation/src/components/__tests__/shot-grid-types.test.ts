import { describe, expect, it } from 'vitest';

import { STATUS_VARIANTS, toShotGridShot } from '../shot-grid/types';
import type { ShotDisplayStatus } from '../shot-grid/types';

describe('ShotGrid Types', () => {
  describe('STATUS_VARIANTS', () => {
    it('should have variants for all status types', () => {
      const statuses: ShotDisplayStatus[] = [
        'pending',
        'queued',
        'generating',
        'completed',
        'failed',
      ];

      statuses.forEach((status) => {
        expect(STATUS_VARIANTS[status]).toBeDefined();
        expect(typeof STATUS_VARIANTS[status]).toBe('string');
      });
    });

    it('should have pending status with muted styling', () => {
      expect(STATUS_VARIANTS.pending).toContain('muted');
    });

    it('should have completed status with green styling', () => {
      expect(STATUS_VARIANTS.completed).toContain('green');
    });

    it('should have failed status with red styling', () => {
      expect(STATUS_VARIANTS.failed).toContain('red');
    });

    it('should have generating status with yellow styling', () => {
      expect(STATUS_VARIANTS.generating).toContain('yellow');
    });

    it('should have queued status with blue styling', () => {
      expect(STATUS_VARIANTS.queued).toContain('blue');
    });
  });

  describe('toShotGridShot', () => {
    const mockShot = {
      id: 'shot-123',
      episodeId: 'episode-456',
      sceneNumber: 1,
      shotNumber: 3,
      sequenceNumber: 5,
      description: 'A wide shot of the city',
      duration: 10,
      status: 'pending' as const,
      cameraAngle: 'wide' as const,
      cameraMovement: 'static' as const,
      cameraDirection: null,
      prompt: 'Cinematic wide shot of downtown at sunset',
      videoUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      metadata: null,
      generationSettings: {
        aspectRatio: '16:9',
        provider: 'kling' as const,
      },
      generationJobId: null,
      generationStartedAt: null,
      generationCompletedAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should convert a shot to ShotGridShot format', () => {
      const result = toShotGridShot(mockShot);

      expect(result.id).toBe('shot-123');
      expect(result.sceneNumber).toBe(1);
      expect(result.shotNumber).toBe(3);
      expect(result.sequenceNumber).toBe(5);
      expect(result.description).toBe('A wide shot of the city');
      expect(result.duration).toBe(10);
      expect(result.status).toBe('pending');
      expect(result.prompt).toBe('Cinematic wide shot of downtown at sunset');
      expect(result.videoUrl).toBe('https://example.com/video.mp4');
      expect(result.thumbnailUrl).toBe('https://example.com/thumb.jpg');
      expect(result.aspectRatio).toBe('16:9');
    });

    it('should use shotNumber as sequenceNumber when sequenceNumber is undefined', () => {
      const shotWithoutSequence = {
        ...mockShot,
        sequenceNumber: undefined,
      };

      const result = toShotGridShot(shotWithoutSequence);

      expect(result.sequenceNumber).toBe(3); // Uses shotNumber
    });

    it('should default aspectRatio to 16:9 when generationSettings is null', () => {
      const shotWithoutSettings = {
        ...mockShot,
        generationSettings: null,
      };

      const result = toShotGridShot(shotWithoutSettings);

      expect(result.aspectRatio).toBe('16:9');
    });

    it('should default aspectRatio to 16:9 when aspectRatio is not set', () => {
      const shotWithoutAspectRatio = {
        ...mockShot,
        generationSettings: {
          provider: 'kling' as const,
        },
      };

      const result = toShotGridShot(shotWithoutAspectRatio);

      expect(result.aspectRatio).toBe('16:9');
    });

    it('should handle null prompt', () => {
      const shotWithNullPrompt = {
        ...mockShot,
        prompt: null,
      };

      const result = toShotGridShot(shotWithNullPrompt);

      expect(result.prompt).toBeNull();
    });

    it('should handle null videoUrl and thumbnailUrl', () => {
      const shotWithNullUrls = {
        ...mockShot,
        videoUrl: null,
        thumbnailUrl: null,
      };

      const result = toShotGridShot(shotWithNullUrls);

      expect(result.videoUrl).toBeNull();
      expect(result.thumbnailUrl).toBeNull();
    });

    it('should set progress and errorMessage to undefined', () => {
      const result = toShotGridShot(mockShot);

      expect(result.progress).toBeUndefined();
      expect(result.errorMessage).toBeUndefined();
    });
  });
});
