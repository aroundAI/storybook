import { describe, expect, it } from 'vitest';

import { ReorderShotsSchema } from '../src/lib/schemas';
import {
  CharacterInputSchema,
  GenerateFullStorySchema,
  GenerateStoryIdeasSchema,
} from '../src/lib/schemas/story.schema';

describe('Story Schemas', () => {
  describe('GenerateStoryIdeasSchema', () => {
    const validEpisodeId = '123e4567-e89b-12d3-a456-426614174000';

    it('should accept valid input with all fields', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise:
          'A detective investigates a mysterious disappearance in a small town',
        genre: 'mystery',
        targetAudience: 'adults',
        style: 'noir',
        numberOfIdeas: 3,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid input with only required fields', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'A simple story about friendship',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.numberOfIdeas).toBe(3); // default value
      }
    });

    it('should reject premise shorter than 10 characters', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'Too short',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'at least 10 character',
        );
      }
    });

    it('should reject premise longer than 2000 characters', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'a'.repeat(2001),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'at most 2000 character',
        );
      }
    });

    it('should reject numberOfIdeas less than 1', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'A valid premise here',
        numberOfIdeas: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject numberOfIdeas greater than 5', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'A valid premise here',
        numberOfIdeas: 6,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer numberOfIdeas', () => {
      const result = GenerateStoryIdeasSchema.safeParse({
        episodeId: validEpisodeId,
        premise: 'A valid premise here',
        numberOfIdeas: 2.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CharacterInputSchema', () => {
    it('should accept valid character input', () => {
      const result = CharacterInputSchema.safeParse({
        name: 'John Doe',
        description: 'A brave detective with a troubled past',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = CharacterInputSchema.safeParse({
        name: '',
        description: 'A description',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty description', () => {
      const result = CharacterInputSchema.safeParse({
        name: 'John',
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      expect(CharacterInputSchema.safeParse({ name: 'John' }).success).toBe(
        false,
      );
      expect(
        CharacterInputSchema.safeParse({ description: 'Desc' }).success,
      ).toBe(false);
      expect(CharacterInputSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('GenerateFullStorySchema', () => {
    const validInput = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
      version: 1,
      title: 'The Mystery Unfolds',
      logline: 'A detective uncovers dark secrets in a quiet town',
      targetDuration: 180, // 3 minutes
    };

    it('should accept valid input with required fields', () => {
      const result = GenerateFullStorySchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept valid input with all optional fields', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        characters: [
          { name: 'John', description: 'The detective' },
          { name: 'Jane', description: 'The witness' },
        ],
        worldDetails: 'A small coastal town in the 1950s',
        style: 'noir',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid episodeId', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        episodeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive version', () => {
      expect(
        GenerateFullStorySchema.safeParse({
          ...validInput,
          version: 0,
        }).success,
      ).toBe(false);

      expect(
        GenerateFullStorySchema.safeParse({
          ...validInput,
          version: -1,
        }).success,
      ).toBe(false);
    });

    it('should reject empty title', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding 255 characters', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        title: 'a'.repeat(256),
      });
      expect(result.success).toBe(false);
    });

    it('should reject logline shorter than 10 characters', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        logline: 'Too short',
      });
      expect(result.success).toBe(false);
    });

    it('should reject logline longer than 1000 characters', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        logline: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject targetDuration less than 60 seconds', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        targetDuration: 59,
      });
      expect(result.success).toBe(false);
    });

    it('should reject targetDuration greater than 7200 seconds (2 hours)', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        targetDuration: 7201,
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer targetDuration', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        targetDuration: 180.5,
      });
      expect(result.success).toBe(false);
    });

    it('should reject worldDetails longer than 1000 characters', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        worldDetails: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid characters array', () => {
      const result = GenerateFullStorySchema.safeParse({
        ...validInput,
        characters: [{ name: '', description: 'Invalid character' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReorderShotsSchema', () => {
    const validInput = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
      shotIds: [
        '123e4567-e89b-12d3-a456-426614174001',
        '123e4567-e89b-12d3-a456-426614174002',
        '123e4567-e89b-12d3-a456-426614174003',
      ],
    };

    it('should accept valid input', () => {
      const result = ReorderShotsSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject invalid episodeId', () => {
      const result = ReorderShotsSchema.safeParse({
        ...validInput,
        episodeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty shotIds array', () => {
      const result = ReorderShotsSchema.safeParse({
        ...validInput,
        shotIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid shot UUIDs', () => {
      const result = ReorderShotsSchema.safeParse({
        ...validInput,
        shotIds: ['not-a-uuid', '123e4567-e89b-12d3-a456-426614174001'],
      });
      expect(result.success).toBe(false);
    });

    it('should accept single shot in array', () => {
      const result = ReorderShotsSchema.safeParse({
        episodeId: '123e4567-e89b-12d3-a456-426614174000',
        shotIds: ['123e4567-e89b-12d3-a456-426614174001'],
      });
      expect(result.success).toBe(true);
    });
  });
});
