import { describe, expect, it } from 'vitest';

import {
  CancelVideoJobSchema,
  GenerateVideoSchema,
  GenerationStatusSchema,
  PollVideoStatusSchema,
  VideoGenerationRequestSchema,
  VideoProviderSchema,
} from '../src/lib/schemas';

describe('Video Generation Schemas', () => {
  describe('VideoProviderSchema', () => {
    it('should accept valid providers', () => {
      expect(VideoProviderSchema.safeParse('kling').success).toBe(true);
      expect(VideoProviderSchema.safeParse('runway').success).toBe(true);
      expect(VideoProviderSchema.safeParse('luma').success).toBe(true);
    });

    it('should reject invalid providers', () => {
      expect(VideoProviderSchema.safeParse('invalid').success).toBe(false);
      expect(VideoProviderSchema.safeParse('').success).toBe(false);
      expect(VideoProviderSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('GenerationStatusSchema', () => {
    it('should accept all valid statuses', () => {
      const statuses = [
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
      ];

      statuses.forEach((status) => {
        expect(GenerationStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(GenerationStatusSchema.safeParse('running').success).toBe(false);
      expect(GenerationStatusSchema.safeParse('').success).toBe(false);
    });
  });

  describe('VideoGenerationRequestSchema', () => {
    const validRequest = {
      prompt: 'A beautiful sunset over the ocean',
      duration: 5,
      aspectRatio: '16:9',
    };

    it('should accept valid request', () => {
      const result = VideoGenerationRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should accept request with all optional fields', () => {
      const fullRequest = {
        ...validRequest,
        negativePrompt: 'blurry, low quality',
        seed: 12345,
        modelVersion: 'v1.5',
        settings: { custom: 'value' },
      };

      const result = VideoGenerationRequestSchema.safeParse(fullRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty prompt', () => {
      const result = VideoGenerationRequestSchema.safeParse({
        ...validRequest,
        prompt: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject prompt exceeding max length', () => {
      const result = VideoGenerationRequestSchema.safeParse({
        ...validRequest,
        prompt: 'a'.repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative prompt exceeding max length', () => {
      const result = VideoGenerationRequestSchema.safeParse({
        ...validRequest,
        negativePrompt: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive duration', () => {
      expect(
        VideoGenerationRequestSchema.safeParse({
          ...validRequest,
          duration: 0,
        }).success,
      ).toBe(false);

      expect(
        VideoGenerationRequestSchema.safeParse({
          ...validRequest,
          duration: -5,
        }).success,
      ).toBe(false);
    });

    it('should reject duration exceeding maximum', () => {
      const result = VideoGenerationRequestSchema.safeParse({
        ...validRequest,
        duration: 21,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid aspect ratio format', () => {
      const invalidRatios = ['16-9', '16/9', 'wide', '16:9:1', ''];

      invalidRatios.forEach((ratio) => {
        const result = VideoGenerationRequestSchema.safeParse({
          ...validRequest,
          aspectRatio: ratio,
        });
        expect(result.success).toBe(false);
      });
    });

    it('should accept various valid aspect ratios', () => {
      const validRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

      validRatios.forEach((ratio) => {
        const result = VideoGenerationRequestSchema.safeParse({
          ...validRequest,
          aspectRatio: ratio,
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject missing required fields', () => {
      expect(
        VideoGenerationRequestSchema.safeParse({ prompt: 'test' }).success,
      ).toBe(false);
      expect(
        VideoGenerationRequestSchema.safeParse({ duration: 5 }).success,
      ).toBe(false);
      expect(
        VideoGenerationRequestSchema.safeParse({ aspectRatio: '16:9' }).success,
      ).toBe(false);
    });
  });

  describe('GenerateVideoSchema', () => {
    const validInput = {
      accountId: '123e4567-e89b-12d3-a456-426614174000',
      shotId: '123e4567-e89b-12d3-a456-426614174001',
      provider: 'kling',
      request: {
        prompt: 'A beautiful scene',
        duration: 5,
        aspectRatio: '16:9',
      },
    };

    it('should accept valid input', () => {
      const result = GenerateVideoSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject invalid accountId', () => {
      const result = GenerateVideoSchema.safeParse({
        ...validInput,
        accountId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid shotId', () => {
      const result = GenerateVideoSchema.safeParse({
        ...validInput,
        shotId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = GenerateVideoSchema.safeParse({
        ...validInput,
        provider: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      expect(
        GenerateVideoSchema.safeParse({ accountId: validInput.accountId })
          .success,
      ).toBe(false);
      expect(
        GenerateVideoSchema.safeParse({ shotId: validInput.shotId }).success,
      ).toBe(false);
    });
  });

  describe('PollVideoStatusSchema', () => {
    it('should accept valid UUID', () => {
      const result = PollVideoStatusSchema.safeParse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = PollVideoStatusSchema.safeParse({
        jobId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing jobId', () => {
      const result = PollVideoStatusSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('CancelVideoJobSchema', () => {
    it('should accept valid UUID', () => {
      const result = CancelVideoJobSchema.safeParse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = CancelVideoJobSchema.safeParse({
        jobId: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });
});
