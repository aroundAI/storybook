import { describe, expect, it } from 'vitest';

import {
  GenerateShotListSchema,
  GeneratedShotMetadataSchema,
  GeneratedShotSchema,
  PromptCameraDirectionSchema,
  ShotListGenerationOutputSchema,
  ShotListMetadataSchema,
  ShotListOutputSchema,
  ShotTypeSchema,
  TimeOfDaySchema,
} from '../src/lib/schemas/shot-list.schema';

describe('Shot List Schemas', () => {
  describe('GenerateShotListSchema', () => {
    const validInput = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
    };

    it('should accept valid input with only episodeId', () => {
      const result = GenerateShotListSchema.safeParse(validInput);
      expect(result.success).toBe(true);
      if (result.success) {
        // Check defaults are applied
        expect(result.data.shotDurationMin).toBe(5);
        expect(result.data.shotDurationMax).toBe(8);
        expect(result.data.videoProvider).toBe('veo-3.1');
      }
    });

    it('should accept all optional fields', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        shotDurationMin: 3,
        shotDurationMax: 10,
        videoProvider: 'runway',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid episodeId', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        episodeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject shotDurationMin less than 3', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        shotDurationMin: 2,
      });
      expect(result.success).toBe(false);
    });

    it('should reject shotDurationMin greater than 10', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        shotDurationMin: 11,
      });
      expect(result.success).toBe(false);
    });

    it('should reject shotDurationMax less than 3', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        shotDurationMax: 2,
      });
      expect(result.success).toBe(false);
    });

    it('should reject shotDurationMax greater than 10', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        shotDurationMax: 11,
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid video providers', () => {
      ['veo-3.1', 'kling', 'runway', 'luma'].forEach((provider) => {
        const result = GenerateShotListSchema.safeParse({
          ...validInput,
          videoProvider: provider,
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid video provider', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        videoProvider: 'invalid-provider',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid LLM providers', () => {
      ['anthropic', 'openai', 'google'].forEach((provider) => {
        const result = GenerateShotListSchema.safeParse({
          ...validInput,
          provider,
        });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid LLM provider', () => {
      const result = GenerateShotListSchema.safeParse({
        ...validInput,
        provider: 'invalid-llm',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ShotTypeSchema', () => {
    it('should accept all valid shot types', () => {
      const shotTypes = [
        'wide',
        'medium',
        'close-up',
        'extreme-close-up',
        'over-shoulder',
        'pov',
      ];

      shotTypes.forEach((type) => {
        expect(ShotTypeSchema.safeParse(type).success).toBe(true);
      });
    });

    it('should reject invalid shot types', () => {
      expect(ShotTypeSchema.safeParse('invalid').success).toBe(false);
      expect(ShotTypeSchema.safeParse('').success).toBe(false);
      expect(ShotTypeSchema.safeParse('WIDE').success).toBe(false); // Case sensitive
    });
  });

  describe('PromptCameraDirectionSchema', () => {
    it('should accept any string for camera direction (free-form)', () => {
      const directions = [
        'static',
        'pan_left',
        'pan_right',
        'tilt_up',
        'tilt_down',
        'zoom_in',
        'zoom_out',
        'dolly_in',
        'dolly_out',
        'pan', // Any string is valid
        'dolly',
        'tracking from the side',
      ];

      directions.forEach((direction) => {
        expect(PromptCameraDirectionSchema.safeParse(direction).success).toBe(
          true,
        );
      });
    });

    it('should reject non-string values', () => {
      expect(PromptCameraDirectionSchema.safeParse(123).success).toBe(false);
      expect(PromptCameraDirectionSchema.safeParse(null).success).toBe(false);
      expect(PromptCameraDirectionSchema.safeParse(undefined).success).toBe(
        false,
      );
    });
  });

  describe('TimeOfDaySchema', () => {
    it('should accept all valid times of day', () => {
      const times = [
        'dawn',
        'morning',
        'midday',
        'afternoon',
        'golden-hour',
        'dusk',
        'night',
        'day',
      ];

      times.forEach((time) => {
        expect(TimeOfDaySchema.safeParse(time).success).toBe(true);
      });
    });

    it('should reject invalid times', () => {
      expect(TimeOfDaySchema.safeParse('evening').success).toBe(false);
      expect(TimeOfDaySchema.safeParse('sunset').success).toBe(false);
      expect(TimeOfDaySchema.safeParse('').success).toBe(false);
    });
  });

  describe('GeneratedShotMetadataSchema', () => {
    it('should accept valid metadata with required fields', () => {
      const result = GeneratedShotMetadataSchema.safeParse({
        location: 'Living room',
        timeOfDay: 'day',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = GeneratedShotMetadataSchema.safeParse({
        location: 'Kitchen',
        timeOfDay: 'night',
        mood: 'tense',
        lighting: 'dim, overhead',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing location', () => {
      const result = GeneratedShotMetadataSchema.safeParse({
        timeOfDay: 'day',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing timeOfDay', () => {
      const result = GeneratedShotMetadataSchema.safeParse({
        location: 'Park',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid timeOfDay', () => {
      const result = GeneratedShotMetadataSchema.safeParse({
        location: 'Park',
        timeOfDay: 'sunset', // Invalid value
      });
      expect(result.success).toBe(false);
    });
  });

  describe('GeneratedShotSchema', () => {
    const validShot = {
      sequenceNumber: 1,
      sceneNumber: 1,
      shotNumber: 1,
      shotType: 'wide',
      cameraDirection: 'static',
      description: 'Opening shot of the city skyline',
      action: 'Camera holds on the skyline as the sun rises',
      prompt:
        'Wide shot of futuristic city skyline at dawn, golden sunlight, cinematic',
      characters: ['Maya'],
      duration: 5,
      metadata: {
        location: 'City exterior',
        timeOfDay: 'dawn',
        mood: 'hopeful',
        lighting: 'golden hour',
      },
    };

    it('should accept valid shot', () => {
      const result = GeneratedShotSchema.safeParse(validShot);
      expect(result.success).toBe(true);
    });

    it('should accept shot with empty characters array', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        characters: [],
      });
      expect(result.success).toBe(true);
    });

    it('should accept shot with multiple characters', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        characters: ['Maya', 'John', 'Dr. Smith'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject duration less than 3', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        duration: 2,
      });
      expect(result.success).toBe(false);
    });

    it('should reject duration greater than 10', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        duration: 11,
      });
      expect(result.success).toBe(false);
    });

    it('should accept duration at boundaries', () => {
      expect(
        GeneratedShotSchema.safeParse({ ...validShot, duration: 3 }).success,
      ).toBe(true);
      expect(
        GeneratedShotSchema.safeParse({ ...validShot, duration: 10 }).success,
      ).toBe(true);
    });

    it('should reject invalid shotType', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        shotType: 'invalid-type',
      });
      expect(result.success).toBe(false);
    });

    it('should accept any string cameraDirection (free-form)', () => {
      const result = GeneratedShotSchema.safeParse({
        ...validShot,
        cameraDirection: 'any-custom-direction',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const requiredFields = [
        'sequenceNumber',
        'sceneNumber',
        'shotNumber',
        'shotType',
        'cameraDirection',
        'description',
        'action',
        'prompt',
        'characters',
        'duration',
        'metadata',
      ];

      requiredFields.forEach((field) => {
        const shotWithoutField = { ...validShot };
        delete (shotWithoutField as Record<string, unknown>)[field];
        const result = GeneratedShotSchema.safeParse(shotWithoutField);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('ShotListMetadataSchema', () => {
    const validMetadata = {
      totalShots: 10,
      totalDuration: 60,
      shotTypes: {
        wide: 3,
        medium: 5,
        closeUp: 2,
      },
      locations: ['Living room', 'Kitchen'],
      characters: ['John', 'Jane'],
    };

    it('should accept valid metadata', () => {
      const result = ShotListMetadataSchema.safeParse(validMetadata);
      expect(result.success).toBe(true);
    });

    it('should accept empty arrays for locations and characters', () => {
      const result = ShotListMetadataSchema.safeParse({
        ...validMetadata,
        locations: [],
        characters: [],
      });
      expect(result.success).toBe(true);
    });

    it('should accept zero values for shot type counts', () => {
      const result = ShotListMetadataSchema.safeParse({
        ...validMetadata,
        shotTypes: {
          wide: 0,
          medium: 0,
          closeUp: 0,
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing shotTypes fields', () => {
      const result = ShotListMetadataSchema.safeParse({
        ...validMetadata,
        shotTypes: {
          wide: 3,
          // missing medium and closeUp
        },
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const requiredFields = [
        'totalShots',
        'totalDuration',
        'shotTypes',
        'locations',
        'characters',
      ];

      requiredFields.forEach((field) => {
        const metadataWithoutField = { ...validMetadata };
        delete (metadataWithoutField as Record<string, unknown>)[field];
        const result = ShotListMetadataSchema.safeParse(metadataWithoutField);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('ShotListOutputSchema', () => {
    const validShot = {
      sequenceNumber: 1,
      sceneNumber: 1,
      shotNumber: 1,
      shotType: 'wide',
      cameraDirection: 'static',
      description: 'Opening shot',
      action: 'Camera holds',
      prompt: 'Wide shot of scene',
      characters: [],
      duration: 5,
      metadata: {
        location: 'City',
        timeOfDay: 'day',
      },
    };

    const validOutput = {
      shots: [validShot],
      metadata: {
        totalShots: 1,
        totalDuration: 5,
        shotTypes: { wide: 1, medium: 0, closeUp: 0 },
        locations: ['City'],
        characters: [],
      },
    };

    it('should accept valid output', () => {
      const result = ShotListOutputSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('should accept empty shots array', () => {
      const result = ShotListOutputSchema.safeParse({
        ...validOutput,
        shots: [],
      });
      expect(result.success).toBe(true);
    });

    it('should accept multiple shots', () => {
      const result = ShotListOutputSchema.safeParse({
        ...validOutput,
        shots: [
          { ...validShot, sequenceNumber: 1 },
          { ...validShot, sequenceNumber: 2, shotType: 'medium' },
          { ...validShot, sequenceNumber: 3, shotType: 'close-up' },
        ],
        metadata: {
          totalShots: 3,
          totalDuration: 15,
          shotTypes: { wide: 1, medium: 1, closeUp: 1 },
          locations: ['City'],
          characters: [],
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid shot in array', () => {
      const result = ShotListOutputSchema.safeParse({
        ...validOutput,
        shots: [validShot, { invalidShot: true }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing metadata', () => {
      const result = ShotListOutputSchema.safeParse({
        shots: [validShot],
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing shots', () => {
      const result = ShotListOutputSchema.safeParse({
        metadata: validOutput.metadata,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ShotListGenerationOutputSchema', () => {
    const validShot = {
      sequenceNumber: 1,
      sceneNumber: 1,
      shotNumber: 1,
      shotType: 'wide',
      cameraDirection: 'static',
      description: 'Opening shot',
      action: 'Camera holds',
      prompt: 'Wide shot of scene',
      characters: [],
      duration: 5,
      metadata: {
        location: 'City',
        timeOfDay: 'day',
      },
    };

    const validLLMOutput = {
      shotList: {
        shots: [validShot],
        metadata: {
          totalShots: 1,
          totalDuration: 5,
          shotTypes: { wide: 1, medium: 0, closeUp: 0 },
          locations: ['City'],
          characters: [],
        },
      },
    };

    it('should accept valid LLM output', () => {
      const result = ShotListGenerationOutputSchema.safeParse(validLLMOutput);
      expect(result.success).toBe(true);
    });

    it('should reject missing shotList', () => {
      const result = ShotListGenerationOutputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject null shotList', () => {
      const result = ShotListGenerationOutputSchema.safeParse({
        shotList: null,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid shotList structure', () => {
      const result = ShotListGenerationOutputSchema.safeParse({
        shotList: 'not an object',
      });
      expect(result.success).toBe(false);
    });

    it('should parse and return correct types', () => {
      const result = ShotListGenerationOutputSchema.safeParse(validLLMOutput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shotList.shots).toHaveLength(1);
        expect(result.data.shotList.metadata.totalShots).toBe(1);
        expect(result.data.shotList.shots[0]?.shotType).toBe('wide');
      }
    });
  });
});
