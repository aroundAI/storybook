import { describe, expect, it } from 'vitest';

import {
  CancelMusicGenerationSchema,
  GenerateMusicSchema,
  GetMusicJobStatusSchema,
  MusicGenerationRequestSchema,
} from '../src/lib/schemas';

describe('Music Generation Schemas', () => {
  describe('MusicGenerationRequestSchema', () => {
    it('should validate a valid request', () => {
      const validRequest = {
        prompt: 'Epic orchestral music for battle scene',
        duration: 60,
        genre: 'orchestral',
        mood: 'epic',
        tempo: 'fast',
        instrumentalOnly: true,
        tags: ['cinematic', 'dramatic'],
      };

      const result = MusicGenerationRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should require prompt', () => {
      const invalidRequest = {
        duration: 60,
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate prompt min length', () => {
      const invalidRequest = {
        prompt: '',
        duration: 60,
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate prompt max length', () => {
      const invalidRequest = {
        prompt: 'a'.repeat(1001),
        duration: 60,
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should require duration', () => {
      const invalidRequest = {
        prompt: 'Test music',
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate duration is positive', () => {
      const invalidRequest = {
        prompt: 'Test music',
        duration: 0,
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate duration max', () => {
      const invalidRequest = {
        prompt: 'Test music',
        duration: 300, // Max is 240
      };

      const result = MusicGenerationRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should allow optional fields', () => {
      const minimalRequest = {
        prompt: 'Test music',
        duration: 60,
      };

      const result = MusicGenerationRequestSchema.safeParse(minimalRequest);
      expect(result.success).toBe(true);
    });

    it('should validate tags is an array of strings', () => {
      const validRequest = {
        prompt: 'Test music',
        duration: 60,
        tags: ['tag1', 'tag2'],
      };

      const result = MusicGenerationRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
  });

  describe('GenerateMusicSchema', () => {
    it('should validate a valid generate music action request', () => {
      const validRequest = {
        episodeId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'suno',
        request: {
          prompt: 'Epic battle music',
          duration: 60,
        },
      };

      const result = GenerateMusicSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should require episodeId to be a valid UUID', () => {
      const invalidRequest = {
        episodeId: 'not-a-uuid',
        request: {
          prompt: 'Epic battle music',
          duration: 60,
        },
      };

      const result = GenerateMusicSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should allow provider to be optional', () => {
      const validRequest = {
        episodeId: '550e8400-e29b-41d4-a716-446655440000',
        request: {
          prompt: 'Epic battle music',
          duration: 60,
        },
      };

      const result = GenerateMusicSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate provider is a valid music provider', () => {
      const validRequest = {
        episodeId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'suno',
        request: {
          prompt: 'Epic battle music',
          duration: 60,
        },
      };

      const result = GenerateMusicSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject invalid provider names', () => {
      const invalidRequest = {
        episodeId: '550e8400-e29b-41d4-a716-446655440000',
        provider: 'invalid-provider',
        request: {
          prompt: 'Epic battle music',
          duration: 60,
        },
      };

      const result = GenerateMusicSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('GetMusicJobStatusSchema', () => {
    it('should validate a valid job ID', () => {
      const validRequest = {
        jobId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = GetMusicJobStatusSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should require jobId', () => {
      const invalidRequest = {};

      const result = GetMusicJobStatusSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate jobId is a valid UUID', () => {
      const invalidRequest = {
        jobId: 'not-a-uuid',
      };

      const result = GetMusicJobStatusSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('CancelMusicGenerationSchema', () => {
    it('should validate a valid job ID', () => {
      const validRequest = {
        jobId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = CancelMusicGenerationSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should require jobId', () => {
      const invalidRequest = {};

      const result = CancelMusicGenerationSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should validate jobId is a valid UUID', () => {
      const invalidRequest = {
        jobId: 'invalid',
      };

      const result = CancelMusicGenerationSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
});
