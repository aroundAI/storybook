import { describe, expect, it } from 'vitest';

import {
  AspectRatioSchema,
  GenerateVideoSchema,
  GenerationStatusSchema,
  KlingGenerationSchema,
  LumaGenerationSchema,
  RunwayGenerationSchema,
  UpdateVideoGenerationJobSchema,
  VideoGenerationRequestSchema,
  VideoGenerationSettingsSchema,
  VideoProviderSchema,
} from '../src/video';

describe('Video Schemas', () => {
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('VideoProviderSchema', () => {
    it('should accept valid providers', () => {
      expect(VideoProviderSchema.safeParse('kling').success).toBe(true);
      expect(VideoProviderSchema.safeParse('runway').success).toBe(true);
      expect(VideoProviderSchema.safeParse('luma').success).toBe(true);
    });

    it('should reject invalid providers', () => {
      expect(VideoProviderSchema.safeParse('openai').success).toBe(false);
      expect(VideoProviderSchema.safeParse('').success).toBe(false);
    });
  });

  describe('GenerationStatusSchema', () => {
    it('should accept valid statuses', () => {
      const validStatuses = [
        'pending',
        'queued',
        'processing',
        'completed',
        'failed',
        'cancelled',
      ];
      validStatuses.forEach((status) => {
        expect(GenerationStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(GenerationStatusSchema.safeParse('running').success).toBe(false);
    });
  });

  describe('AspectRatioSchema', () => {
    it('should accept valid aspect ratios', () => {
      expect(AspectRatioSchema.safeParse('16:9').success).toBe(true);
      expect(AspectRatioSchema.safeParse('9:16').success).toBe(true);
      expect(AspectRatioSchema.safeParse('1:1').success).toBe(true);
      expect(AspectRatioSchema.safeParse('4:3').success).toBe(true);
      expect(AspectRatioSchema.safeParse('21:9').success).toBe(true);
    });

    it('should reject invalid aspect ratios', () => {
      expect(AspectRatioSchema.safeParse('widescreen').success).toBe(false);
      expect(AspectRatioSchema.safeParse('16-9').success).toBe(false);
      expect(AspectRatioSchema.safeParse('16/9').success).toBe(false);
    });
  });

  describe('VideoGenerationSettingsSchema', () => {
    it('should accept valid settings', () => {
      const validSettings = {
        provider: 'kling',
        aspectRatio: '16:9',
        duration: 10,
      };
      expect(
        VideoGenerationSettingsSchema.safeParse(validSettings).success,
      ).toBe(true);
    });

    it('should apply defaults', () => {
      const result = VideoGenerationSettingsSchema.parse({
        provider: 'runway',
      });
      expect(result.aspectRatio).toBe('16:9');
      expect(result.duration).toBe(5);
    });

    it('should enforce max duration', () => {
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          duration: 21,
        }).success,
      ).toBe(false);
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          duration: 20,
        }).success,
      ).toBe(true);
    });

    it('should validate quality enum', () => {
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          quality: 'draft',
        }).success,
      ).toBe(true);
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          quality: 'ultra',
        }).success,
      ).toBe(false);
    });

    it('should validate motionStrength range', () => {
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          motionStrength: 0.5,
        }).success,
      ).toBe(true);
      expect(
        VideoGenerationSettingsSchema.safeParse({
          provider: 'kling',
          motionStrength: 1.5,
        }).success,
      ).toBe(false);
    });
  });

  describe('VideoGenerationRequestSchema', () => {
    it('should accept valid request', () => {
      const validRequest = {
        prompt: 'A beautiful sunset over the ocean',
        duration: 5,
        aspectRatio: '16:9',
      };
      expect(VideoGenerationRequestSchema.safeParse(validRequest).success).toBe(
        true,
      );
    });

    it('should enforce prompt length', () => {
      expect(
        VideoGenerationRequestSchema.safeParse({
          prompt: '',
          duration: 5,
          aspectRatio: '16:9',
        }).success,
      ).toBe(false);
      expect(
        VideoGenerationRequestSchema.safeParse({
          prompt: 'a'.repeat(2001),
          duration: 5,
          aspectRatio: '16:9',
        }).success,
      ).toBe(false);
    });

    it('should enforce negative prompt max length', () => {
      expect(
        VideoGenerationRequestSchema.safeParse({
          prompt: 'Test prompt',
          duration: 5,
          aspectRatio: '16:9',
          negativePrompt: 'a'.repeat(1001),
        }).success,
      ).toBe(false);
    });

    it('should accept optional fields', () => {
      const withOptionals = {
        prompt: 'Test prompt',
        duration: 5,
        aspectRatio: '16:9',
        negativePrompt: 'blurry, low quality',
        seed: 12345,
        modelVersion: 'v2.0',
        settings: { customOption: true },
      };
      expect(
        VideoGenerationRequestSchema.safeParse(withOptionals).success,
      ).toBe(true);
    });
  });

  describe('GenerateVideoSchema', () => {
    it('should accept valid generation request', () => {
      const validGenerate = {
        shotId: validUUID,
        provider: 'kling',
        request: {
          prompt: 'Test video prompt',
          duration: 5,
          aspectRatio: '16:9',
        },
      };
      expect(GenerateVideoSchema.safeParse(validGenerate).success).toBe(true);
    });

    it('should require shotId', () => {
      expect(
        GenerateVideoSchema.safeParse({
          provider: 'kling',
          request: {
            prompt: 'Test',
            duration: 5,
            aspectRatio: '16:9',
          },
        }).success,
      ).toBe(false);
    });
  });

  describe('UpdateVideoGenerationJobSchema', () => {
    it('should accept valid update', () => {
      const validUpdate = {
        jobId: validUUID,
        status: 'completed',
        videoUrl: 'https://example.com/video.mp4',
        thumbnailUrl: 'https://example.com/thumb.jpg',
      };
      expect(
        UpdateVideoGenerationJobSchema.safeParse(validUpdate).success,
      ).toBe(true);
    });

    it('should validate progress range', () => {
      expect(
        UpdateVideoGenerationJobSchema.safeParse({
          jobId: validUUID,
          status: 'processing',
          progress: 50,
        }).success,
      ).toBe(true);
      expect(
        UpdateVideoGenerationJobSchema.safeParse({
          jobId: validUUID,
          status: 'processing',
          progress: 101,
        }).success,
      ).toBe(false);
      expect(
        UpdateVideoGenerationJobSchema.safeParse({
          jobId: validUUID,
          status: 'processing',
          progress: -1,
        }).success,
      ).toBe(false);
    });
  });

  describe('KlingGenerationSchema', () => {
    it('should accept Kling-specific options', () => {
      const klingRequest = {
        prompt: 'Test prompt',
        duration: 5,
        aspectRatio: '16:9',
        mode: 'pro',
        negativePrompt: 'a'.repeat(2000), // Kling allows longer negative prompts
      };
      expect(KlingGenerationSchema.safeParse(klingRequest).success).toBe(true);
    });

    it('should validate mode enum', () => {
      expect(
        KlingGenerationSchema.safeParse({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          mode: 'standard',
        }).success,
      ).toBe(true);
      expect(
        KlingGenerationSchema.safeParse({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          mode: 'ultra',
        }).success,
      ).toBe(false);
    });
  });

  describe('RunwayGenerationSchema', () => {
    it('should accept Runway-specific options', () => {
      const runwayRequest = {
        prompt: 'Test prompt',
        duration: 5,
        aspectRatio: '16:9',
        interpolate: true,
        upscale: true,
        watermark: false,
      };
      expect(RunwayGenerationSchema.safeParse(runwayRequest).success).toBe(
        true,
      );
    });

    it('should default watermark to false', () => {
      const result = RunwayGenerationSchema.parse({
        prompt: 'Test',
        duration: 5,
        aspectRatio: '16:9',
      });
      expect(result.watermark).toBe(false);
    });
  });

  describe('LumaGenerationSchema', () => {
    it('should accept Luma-specific options', () => {
      const lumaRequest = {
        prompt: 'Test prompt',
        duration: 5,
        aspectRatio: '16:9',
        loop: true,
        keyframes: [
          { frame: 0, prompt: 'Start scene' },
          { frame: 30, prompt: 'End scene' },
        ],
      };
      expect(LumaGenerationSchema.safeParse(lumaRequest).success).toBe(true);
    });

    it('should validate keyframe structure', () => {
      expect(
        LumaGenerationSchema.safeParse({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          keyframes: [{ frame: -1, prompt: 'Invalid' }],
        }).success,
      ).toBe(false);
    });
  });
});
