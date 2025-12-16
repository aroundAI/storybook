import { describe, expect, it } from 'vitest';

import {
  ApplyLipSyncSchema,
  DetectFacesSchema,
  FaceCoordinatesSchema,
  GenerateLipSyncSchema,
  GetLipSyncJobSchema,
  LipSyncProviderNameSchema,
  LipSyncQualitySchema,
  LipSyncStatusSchema,
  PollLipSyncStatusSchema,
} from '../src/lib/schemas/lip-sync.schema';

describe('Lip Sync Schemas', () => {
  describe('LipSyncProviderNameSchema', () => {
    it('should accept valid provider names', () => {
      expect(LipSyncProviderNameSchema.parse('synclabs')).toBe('synclabs');
      expect(LipSyncProviderNameSchema.parse('wav2lip')).toBe('wav2lip');
    });

    it('should reject invalid provider names', () => {
      expect(() => LipSyncProviderNameSchema.parse('invalid')).toThrow();
      expect(() => LipSyncProviderNameSchema.parse('')).toThrow();
    });
  });

  describe('LipSyncQualitySchema', () => {
    it('should accept valid quality values', () => {
      expect(LipSyncQualitySchema.parse('fast')).toBe('fast');
      expect(LipSyncQualitySchema.parse('standard')).toBe('standard');
      expect(LipSyncQualitySchema.parse('high')).toBe('high');
    });

    it('should reject invalid quality values', () => {
      expect(() => LipSyncQualitySchema.parse('ultra')).toThrow();
      expect(() => LipSyncQualitySchema.parse('')).toThrow();
    });
  });

  describe('LipSyncStatusSchema', () => {
    it('should accept valid status values', () => {
      expect(LipSyncStatusSchema.parse('queued')).toBe('queued');
      expect(LipSyncStatusSchema.parse('pending')).toBe('pending');
      expect(LipSyncStatusSchema.parse('processing')).toBe('processing');
      expect(LipSyncStatusSchema.parse('completed')).toBe('completed');
      expect(LipSyncStatusSchema.parse('failed')).toBe('failed');
    });

    it('should reject invalid status values', () => {
      expect(() => LipSyncStatusSchema.parse('running')).toThrow();
    });
  });

  describe('FaceCoordinatesSchema', () => {
    it('should accept valid face coordinates', () => {
      const result = FaceCoordinatesSchema.parse({
        x: 100,
        y: 50,
        width: 200,
        height: 250,
      });
      expect(result).toEqual({
        x: 100,
        y: 50,
        width: 200,
        height: 250,
      });
    });

    it('should accept zero for x and y', () => {
      const result = FaceCoordinatesSchema.parse({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should reject negative x or y', () => {
      expect(() =>
        FaceCoordinatesSchema.parse({
          x: -1,
          y: 50,
          width: 200,
          height: 250,
        }),
      ).toThrow();
    });

    it('should reject zero or negative width/height', () => {
      expect(() =>
        FaceCoordinatesSchema.parse({
          x: 0,
          y: 0,
          width: 0,
          height: 100,
        }),
      ).toThrow();

      expect(() =>
        FaceCoordinatesSchema.parse({
          x: 0,
          y: 0,
          width: 100,
          height: -10,
        }),
      ).toThrow();
    });
  });

  describe('DetectFacesSchema', () => {
    it('should accept valid video URL', () => {
      const result = DetectFacesSchema.parse({
        videoUrl: 'https://example.com/video.mp4',
      });
      expect(result.videoUrl).toBe('https://example.com/video.mp4');
    });

    it('should reject invalid URL', () => {
      expect(() =>
        DetectFacesSchema.parse({
          videoUrl: 'not-a-url',
        }),
      ).toThrow();
    });

    it('should reject missing videoUrl', () => {
      expect(() => DetectFacesSchema.parse({})).toThrow();
    });
  });

  describe('GenerateLipSyncSchema', () => {
    it('should accept valid input with required fields', () => {
      const result = GenerateLipSyncSchema.parse({
        shotId: '123e4567-e89b-12d3-a456-426614174000',
        dialogueLineId: '123e4567-e89b-12d3-a456-426614174001',
      });
      expect(result.shotId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(result.dialogueLineId).toBe(
        '123e4567-e89b-12d3-a456-426614174001',
      );
      expect(result.quality).toBe('standard'); // default
    });

    it('should accept all optional fields', () => {
      const result = GenerateLipSyncSchema.parse({
        shotId: '123e4567-e89b-12d3-a456-426614174000',
        dialogueLineId: '123e4567-e89b-12d3-a456-426614174001',
        provider: 'wav2lip',
        quality: 'high',
        faceCoordinates: { x: 100, y: 100, width: 200, height: 200 },
      });
      expect(result.provider).toBe('wav2lip');
      expect(result.quality).toBe('high');
      expect(result.faceCoordinates).toEqual({
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
    });

    it('should reject invalid UUID for shotId', () => {
      expect(() =>
        GenerateLipSyncSchema.parse({
          shotId: 'not-a-uuid',
          dialogueLineId: '123e4567-e89b-12d3-a456-426614174001',
        }),
      ).toThrow();
    });

    it('should reject invalid provider', () => {
      expect(() =>
        GenerateLipSyncSchema.parse({
          shotId: '123e4567-e89b-12d3-a456-426614174000',
          dialogueLineId: '123e4567-e89b-12d3-a456-426614174001',
          provider: 'invalid-provider',
        }),
      ).toThrow();
    });
  });

  describe('ApplyLipSyncSchema', () => {
    it('should accept valid job ID', () => {
      const result = ApplyLipSyncSchema.parse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should reject invalid UUID', () => {
      expect(() =>
        ApplyLipSyncSchema.parse({
          jobId: 'not-a-uuid',
        }),
      ).toThrow();
    });
  });

  describe('GetLipSyncJobSchema', () => {
    it('should accept jobId', () => {
      const result = GetLipSyncJobSchema.parse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should accept shotId', () => {
      const result = GetLipSyncJobSchema.parse({
        shotId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.shotId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should accept both jobId and shotId', () => {
      const result = GetLipSyncJobSchema.parse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
        shotId: '123e4567-e89b-12d3-a456-426614174001',
      });
      expect(result.jobId).toBeDefined();
      expect(result.shotId).toBeDefined();
    });

    it('should reject when neither is provided', () => {
      expect(() => GetLipSyncJobSchema.parse({})).toThrow(
        'Either jobId or shotId must be provided',
      );
    });
  });

  describe('PollLipSyncStatusSchema', () => {
    it('should accept valid job ID', () => {
      const result = PollLipSyncStatusSchema.parse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should reject invalid UUID', () => {
      expect(() =>
        PollLipSyncStatusSchema.parse({
          jobId: 'not-a-uuid',
        }),
      ).toThrow();
    });
  });
});
