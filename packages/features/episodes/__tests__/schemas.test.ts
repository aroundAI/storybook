import { describe, expect, it } from 'vitest';

import {
  CameraAngleSchema,
  CameraMovementSchema,
  CreateEpisodeSchema,
  CreateShotSchema,
  EpisodeMetadataSchema,
  EpisodeStatusSchema,
  ShotGenerationSettingsSchema,
  ShotMetadataSchema,
  ShotStatusSchema,
  UpdateEpisodeSchema,
  UpdateShotSchema,
} from '../src/lib/schemas';

describe('Episodes Schemas', () => {
  describe('EpisodeStatusSchema', () => {
    it('should accept all valid episode statuses', () => {
      const statuses = [
        'draft',
        'planning',
        'in_progress',
        'completed',
        'published',
      ];

      statuses.forEach((status) => {
        expect(EpisodeStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(EpisodeStatusSchema.safeParse('invalid').success).toBe(false);
      expect(EpisodeStatusSchema.safeParse('').success).toBe(false);
      expect(EpisodeStatusSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('ShotStatusSchema', () => {
    it('should accept all valid shot statuses', () => {
      const statuses = ['pending', 'generating', 'completed', 'failed'];

      statuses.forEach((status) => {
        expect(ShotStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(ShotStatusSchema.safeParse('running').success).toBe(false);
      expect(ShotStatusSchema.safeParse('cancelled').success).toBe(false);
    });
  });

  describe('CameraAngleSchema', () => {
    it('should accept all valid camera angles', () => {
      const angles = [
        'wide',
        'medium',
        'close-up',
        'extreme-close-up',
        'over-the-shoulder',
        'pov',
        'low-angle',
        'high-angle',
        'birds-eye',
        'dutch-angle',
      ];

      angles.forEach((angle) => {
        expect(CameraAngleSchema.safeParse(angle).success).toBe(true);
      });
    });

    it('should reject invalid angles', () => {
      expect(CameraAngleSchema.safeParse('zoom').success).toBe(false);
      expect(CameraAngleSchema.safeParse('').success).toBe(false);
    });
  });

  describe('CameraMovementSchema', () => {
    it('should accept all valid camera movements', () => {
      const movements = [
        'static',
        'pan',
        'tilt',
        'zoom',
        'dolly',
        'tracking',
        'crane',
        'handheld',
        'steadicam',
      ];

      movements.forEach((movement) => {
        expect(CameraMovementSchema.safeParse(movement).success).toBe(true);
      });
    });

    it('should reject invalid movements', () => {
      expect(CameraMovementSchema.safeParse('shake').success).toBe(false);
      expect(CameraMovementSchema.safeParse('').success).toBe(false);
    });
  });

  describe('EpisodeMetadataSchema', () => {
    it('should accept empty object', () => {
      const result = EpisodeMetadataSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = EpisodeMetadataSchema.safeParse({
        sceneCount: 5,
        shotCount: 20,
        totalDuration: 300.5,
        themes: ['adventure', 'comedy'],
        tags: ['episode-1', 'pilot'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject negative sceneCount', () => {
      const result = EpisodeMetadataSchema.safeParse({
        sceneCount: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer sceneCount', () => {
      const result = EpisodeMetadataSchema.safeParse({
        sceneCount: 5.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative totalDuration', () => {
      const result = EpisodeMetadataSchema.safeParse({
        totalDuration: -100,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateEpisodeSchema', () => {
    const validEpisode = {
      projectId: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Episode 1',
      episodeNumber: 1,
    };

    it('should accept valid input', () => {
      const result = CreateEpisodeSchema.safeParse(validEpisode);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = CreateEpisodeSchema.safeParse({
        ...validEpisode,
        description: 'First episode of the series',
        script: 'INT. LIVING ROOM - DAY\n...',
        metadata: { sceneCount: 3 },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid projectId', () => {
      const result = CreateEpisodeSchema.safeParse({
        ...validEpisode,
        projectId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const result = CreateEpisodeSchema.safeParse({
        ...validEpisode,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding max length', () => {
      const result = CreateEpisodeSchema.safeParse({
        ...validEpisode,
        title: 'a'.repeat(256),
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive episode number', () => {
      expect(
        CreateEpisodeSchema.safeParse({
          ...validEpisode,
          episodeNumber: 0,
        }).success,
      ).toBe(false);

      expect(
        CreateEpisodeSchema.safeParse({
          ...validEpisode,
          episodeNumber: -1,
        }).success,
      ).toBe(false);
    });

    it('should reject non-integer episode number', () => {
      const result = CreateEpisodeSchema.safeParse({
        ...validEpisode,
        episodeNumber: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateEpisodeSchema', () => {
    const validUpdate = {
      id: '123e4567-e89b-12d3-a456-426614174000',
    };

    it('should accept minimal update (id only)', () => {
      const result = UpdateEpisodeSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });

    it('should accept all optional update fields', () => {
      const result = UpdateEpisodeSchema.safeParse({
        ...validUpdate,
        title: 'Updated Title',
        description: 'Updated description',
        episodeNumber: 2,
        script: 'Updated script',
        status: 'in_progress',
        duration: 120.5,
        metadata: { sceneCount: 5 },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid id', () => {
      const result = UpdateEpisodeSchema.safeParse({
        id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const result = UpdateEpisodeSchema.safeParse({
        ...validUpdate,
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative duration', () => {
      const result = UpdateEpisodeSchema.safeParse({
        ...validUpdate,
        duration: -10,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ShotMetadataSchema', () => {
    it('should accept empty object', () => {
      const result = ShotMetadataSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept all fields', () => {
      const result = ShotMetadataSchema.safeParse({
        characters: ['John', 'Jane'],
        locations: ['Living Room'],
        props: ['Coffee Cup', 'Newspaper'],
        dialogue: 'Hello, world!',
        soundEffects: ['door_open', 'footsteps'],
        music: 'Ambient soundtrack',
        lighting: 'Natural daylight',
        mood: 'Tense',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ShotGenerationSettingsSchema', () => {
    it('should accept empty object', () => {
      const result = ShotGenerationSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept all valid providers', () => {
      ['kling', 'runway', 'luma'].forEach((provider) => {
        const result = ShotGenerationSettingsSchema.safeParse({ provider });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid provider', () => {
      const result = ShotGenerationSettingsSchema.safeParse({
        provider: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all fields', () => {
      const result = ShotGenerationSettingsSchema.safeParse({
        provider: 'kling',
        modelVersion: 'v1.5',
        aspectRatio: '16:9',
        duration: 5,
        seed: 12345,
        negativePrompt: 'blurry, low quality',
      });
      expect(result.success).toBe(true);
    });

    it('should reject non-positive duration', () => {
      const result = ShotGenerationSettingsSchema.safeParse({
        duration: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive seed', () => {
      const result = ShotGenerationSettingsSchema.safeParse({
        seed: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateShotSchema', () => {
    const validShot = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
      sceneNumber: 1,
      shotNumber: 1,
      description: 'Opening shot',
      duration: 5,
    };

    it('should accept valid input', () => {
      const result = CreateShotSchema.safeParse(validShot);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = CreateShotSchema.safeParse({
        ...validShot,
        cameraAngle: 'wide',
        cameraMovement: 'dolly',
        prompt: 'A wide shot of the city skyline at sunset',
        metadata: { characters: ['John'] },
        generationSettings: { provider: 'kling' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid episodeId', () => {
      const result = CreateShotSchema.safeParse({
        ...validShot,
        episodeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty description', () => {
      const result = CreateShotSchema.safeParse({
        ...validShot,
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive scene/shot numbers', () => {
      expect(
        CreateShotSchema.safeParse({
          ...validShot,
          sceneNumber: 0,
        }).success,
      ).toBe(false);

      expect(
        CreateShotSchema.safeParse({
          ...validShot,
          shotNumber: -1,
        }).success,
      ).toBe(false);
    });

    it('should reject non-positive duration', () => {
      const result = CreateShotSchema.safeParse({
        ...validShot,
        duration: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateShotSchema', () => {
    const validUpdate = {
      id: '123e4567-e89b-12d3-a456-426614174000',
    };

    it('should accept minimal update (id only)', () => {
      const result = UpdateShotSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = UpdateShotSchema.safeParse({
        ...validUpdate,
        sceneNumber: 2,
        shotNumber: 3,
        description: 'Updated description',
        duration: 10,
        cameraAngle: 'close-up',
        cameraMovement: 'static',
        prompt: 'New prompt',
        status: 'completed',
        videoUrl: 'https://example.com/video.mp4',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        metadata: { mood: 'happy' },
        generationSettings: { provider: 'runway' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid id', () => {
      const result = UpdateShotSchema.safeParse({
        id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const result = UpdateShotSchema.safeParse({
        ...validUpdate,
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid video URL', () => {
      const result = UpdateShotSchema.safeParse({
        ...validUpdate,
        videoUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid thumbnail URL', () => {
      const result = UpdateShotSchema.safeParse({
        ...validUpdate,
        thumbnailUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });
});
