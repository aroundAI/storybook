import { describe, expect, it } from 'vitest';

import {
  BatchCreateShotsSchema,
  CameraAngleSchema,
  CameraMovementSchema,
  CreateShotSchema,
  ShotCompositionSchema,
  ShotMetadataSchema,
  ShotStatusSchema,
  UpdateShotSchema,
} from '../src/shot';

describe('Shot Schemas', () => {
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('ShotStatusSchema', () => {
    it('should accept valid statuses', () => {
      const validStatuses = [
        'pending',
        'queued',
        'generating',
        'processing',
        'completed',
        'failed',
        'cancelled',
      ];
      validStatuses.forEach((status) => {
        expect(ShotStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(ShotStatusSchema.safeParse('done').success).toBe(false);
      expect(ShotStatusSchema.safeParse('').success).toBe(false);
    });
  });

  describe('CameraAngleSchema', () => {
    it('should accept all valid camera angles', () => {
      const validAngles = [
        'wide',
        'full',
        'medium',
        'medium-close-up',
        'close-up',
        'extreme-close-up',
        'over-the-shoulder',
        'pov',
        'low-angle',
        'high-angle',
        'birds-eye',
        'dutch-angle',
        'aerial',
      ];
      validAngles.forEach((angle) => {
        expect(CameraAngleSchema.safeParse(angle).success).toBe(true);
      });
    });

    it('should reject invalid angles', () => {
      expect(CameraAngleSchema.safeParse('fisheye').success).toBe(false);
    });
  });

  describe('CameraMovementSchema', () => {
    it('should accept all valid camera movements', () => {
      const validMovements = [
        'static',
        'pan-left',
        'pan-right',
        'tilt-up',
        'tilt-down',
        'zoom-in',
        'zoom-out',
        'dolly-in',
        'dolly-out',
        'tracking',
        'crane-up',
        'crane-down',
        'handheld',
        'steadicam',
        'orbit',
      ];
      validMovements.forEach((movement) => {
        expect(CameraMovementSchema.safeParse(movement).success).toBe(true);
      });
    });

    it('should reject invalid movements', () => {
      expect(CameraMovementSchema.safeParse('shake').success).toBe(false);
    });
  });

  describe('ShotCompositionSchema', () => {
    it('should accept valid composition', () => {
      const validComposition = {
        framing: 'tight on subject',
        focus: 'sharp foreground',
        depth: 'shallow',
        rule: 'rule-of-thirds',
      };
      expect(ShotCompositionSchema.safeParse(validComposition).success).toBe(
        true,
      );
    });

    it('should validate depth enum', () => {
      expect(
        ShotCompositionSchema.safeParse({ depth: 'shallow' }).success,
      ).toBe(true);
      expect(ShotCompositionSchema.safeParse({ depth: 'deep' }).success).toBe(
        true,
      );
      expect(ShotCompositionSchema.safeParse({ depth: 'medium' }).success).toBe(
        true,
      );
      expect(
        ShotCompositionSchema.safeParse({ depth: 'infinite' }).success,
      ).toBe(false);
    });

    it('should validate rule enum', () => {
      expect(
        ShotCompositionSchema.safeParse({ rule: 'rule-of-thirds' }).success,
      ).toBe(true);
      expect(
        ShotCompositionSchema.safeParse({ rule: 'golden-ratio' }).success,
      ).toBe(true);
      expect(
        ShotCompositionSchema.safeParse({ rule: 'centered' }).success,
      ).toBe(true);
      expect(
        ShotCompositionSchema.safeParse({ rule: 'symmetrical' }).success,
      ).toBe(true);
      expect(ShotCompositionSchema.safeParse({ rule: 'random' }).success).toBe(
        false,
      );
    });
  });

  describe('ShotMetadataSchema', () => {
    it('should accept valid metadata', () => {
      const validMetadata = {
        characters: [validUUID],
        locations: [validUUID],
        props: [validUUID],
        dialogue: 'Hello, world!',
        action: 'Character walks across room',
        soundEffects: ['footsteps', 'door_creak'],
        music: 'Tense orchestral',
        lighting: 'dramatic',
        mood: 'suspenseful',
        colorGrading: 'desaturated',
        visualEffects: ['dust_particles', 'lens_flare'],
        composition: {
          depth: 'shallow',
          rule: 'rule-of-thirds',
        },
      };
      expect(ShotMetadataSchema.safeParse(validMetadata).success).toBe(true);
    });

    it('should validate lighting enum', () => {
      const validLighting = [
        'natural',
        'soft',
        'hard',
        'dramatic',
        'low-key',
        'high-key',
      ];
      validLighting.forEach((lighting) => {
        expect(ShotMetadataSchema.safeParse({ lighting }).success).toBe(true);
      });
      expect(ShotMetadataSchema.safeParse({ lighting: 'neon' }).success).toBe(
        false,
      );
    });
  });

  describe('CreateShotSchema', () => {
    it('should accept valid shot data', () => {
      const validShot = {
        episodeId: validUUID,
        sceneNumber: 1,
        shotNumber: 1,
        description: 'Wide establishing shot of the city',
      };
      expect(CreateShotSchema.safeParse(validShot).success).toBe(true);
    });

    it('should apply default duration', () => {
      const result = CreateShotSchema.parse({
        episodeId: validUUID,
        sceneNumber: 1,
        shotNumber: 1,
        description: 'Test shot',
      });
      expect(result.duration).toBe(5);
    });

    it('should require episodeId, sceneNumber, shotNumber, and description', () => {
      expect(CreateShotSchema.safeParse({}).success).toBe(false);
      expect(
        CreateShotSchema.safeParse({
          episodeId: validUUID,
          sceneNumber: 1,
          shotNumber: 1,
        }).success,
      ).toBe(false);
    });

    it('should enforce non-empty description', () => {
      expect(
        CreateShotSchema.safeParse({
          episodeId: validUUID,
          sceneNumber: 1,
          shotNumber: 1,
          description: '',
        }).success,
      ).toBe(false);
    });

    it('should enforce positive scene and shot numbers', () => {
      expect(
        CreateShotSchema.safeParse({
          episodeId: validUUID,
          sceneNumber: 0,
          shotNumber: 1,
          description: 'Test',
        }).success,
      ).toBe(false);
      expect(
        CreateShotSchema.safeParse({
          episodeId: validUUID,
          sceneNumber: 1,
          shotNumber: -1,
          description: 'Test',
        }).success,
      ).toBe(false);
    });

    it('should accept optional camera settings', () => {
      const withCamera = {
        episodeId: validUUID,
        sceneNumber: 1,
        shotNumber: 1,
        description: 'Test shot',
        cameraAngle: 'wide',
        cameraMovement: 'pan-right',
      };
      expect(CreateShotSchema.safeParse(withCamera).success).toBe(true);
    });

    it('should accept optional prompt and metadata', () => {
      const withExtras = {
        episodeId: validUUID,
        sceneNumber: 1,
        shotNumber: 1,
        description: 'Test shot',
        prompt: 'A cinematic wide shot of a city at sunset',
        metadata: {
          mood: 'hopeful',
          lighting: 'natural',
        },
      };
      expect(CreateShotSchema.safeParse(withExtras).success).toBe(true);
    });
  });

  describe('UpdateShotSchema', () => {
    it('should require id', () => {
      expect(
        UpdateShotSchema.safeParse({ description: 'Updated' }).success,
      ).toBe(false);
    });

    it('should accept partial updates', () => {
      const validUpdate = {
        id: validUUID,
        description: 'Updated description',
      };
      expect(UpdateShotSchema.safeParse(validUpdate).success).toBe(true);
    });

    it('should accept status update', () => {
      const statusUpdate = {
        id: validUUID,
        status: 'completed',
      };
      expect(UpdateShotSchema.safeParse(statusUpdate).success).toBe(true);
    });

    it('should accept video and thumbnail URLs', () => {
      const withUrls = {
        id: validUUID,
        videoUrl: 'https://example.com/video.mp4',
        thumbnailUrl: 'https://example.com/thumb.jpg',
      };
      expect(UpdateShotSchema.safeParse(withUrls).success).toBe(true);
    });
  });

  describe('BatchCreateShotsSchema', () => {
    it('should accept valid batch data', () => {
      const validBatch = {
        episodeId: validUUID,
        shots: [
          {
            sceneNumber: 1,
            shotNumber: 1,
            description: 'First shot',
          },
          {
            sceneNumber: 1,
            shotNumber: 2,
            description: 'Second shot',
          },
        ],
      };
      expect(BatchCreateShotsSchema.safeParse(validBatch).success).toBe(true);
    });

    it('should allow empty shots array', () => {
      const emptyBatch = {
        episodeId: validUUID,
        shots: [],
      };
      expect(BatchCreateShotsSchema.safeParse(emptyBatch).success).toBe(true);
    });

    it('should not require episodeId in individual shots', () => {
      const validBatch = {
        episodeId: validUUID,
        shots: [
          {
            sceneNumber: 1,
            shotNumber: 1,
            description: 'Test shot',
          },
        ],
      };
      expect(BatchCreateShotsSchema.safeParse(validBatch).success).toBe(true);
    });
  });
});
