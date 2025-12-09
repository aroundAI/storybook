/**
 * Character Schema Tests (FILM-202)
 */
import { describe, expect, it } from 'vitest';

import {
  ClothingStyleSchema,
  CreateCharacterSchema,
  ListCharactersSchema,
  PersonalityTraitsSchema,
  PhysicalAttributesSchema,
  UpdateCharacterSchema,
} from '../src/lib/schemas/character.schema';

describe('Character Schemas', () => {
  describe('PhysicalAttributesSchema', () => {
    it('should accept valid physical attributes', () => {
      const valid = {
        age: 28,
        ageRange: 'young_adult',
        gender: 'female',
        ethnicity: 'East Asian',
        build: 'athletic',
        hairColor: 'black',
        hairStyle: 'long, straight',
        eyeColor: 'brown',
        skinTone: 'light',
        distinctiveFeatures: ['scar above left eyebrow', 'wears glasses'],
      };
      expect(() => PhysicalAttributesSchema.parse(valid)).not.toThrow();
    });

    it('should accept empty object', () => {
      expect(() => PhysicalAttributesSchema.parse({})).not.toThrow();
    });

    it('should reject invalid age (> 150)', () => {
      expect(() => PhysicalAttributesSchema.parse({ age: 200 })).toThrow();
    });

    it('should reject negative age', () => {
      expect(() => PhysicalAttributesSchema.parse({ age: -5 })).toThrow();
    });

    it('should reject invalid gender enum', () => {
      expect(() =>
        PhysicalAttributesSchema.parse({ gender: 'alien' }),
      ).toThrow();
    });

    it('should accept valid gender enums', () => {
      const genders = ['male', 'female', 'non_binary', 'other'];
      genders.forEach((gender) => {
        expect(() => PhysicalAttributesSchema.parse({ gender })).not.toThrow();
      });
    });

    it('should reject invalid build enum', () => {
      expect(() =>
        PhysicalAttributesSchema.parse({ build: 'obese' }),
      ).toThrow();
    });

    it('should accept valid build enums', () => {
      const builds = ['slim', 'athletic', 'average', 'heavy', 'muscular'];
      builds.forEach((build) => {
        expect(() => PhysicalAttributesSchema.parse({ build })).not.toThrow();
      });
    });

    it('should reject too many distinctive features', () => {
      const tooManyFeatures = Array(25).fill('feature');
      expect(() =>
        PhysicalAttributesSchema.parse({
          distinctiveFeatures: tooManyFeatures,
        }),
      ).toThrow();
    });

    it('should reject feature strings that are too long', () => {
      const longFeature = 'a'.repeat(250);
      expect(() =>
        PhysicalAttributesSchema.parse({
          distinctiveFeatures: [longFeature],
        }),
      ).toThrow();
    });
  });

  describe('PersonalityTraitsSchema', () => {
    it('should accept valid personality traits', () => {
      const valid = {
        traits: ['brave', 'intelligent', 'cautious'],
        mannerisms: [
          'pushes glasses up when thinking',
          'taps pen when nervous',
        ],
        motivations: 'Wants to prove herself as a detective',
        fears: 'Losing her sister',
        strengths: ['analytical thinking', 'attention to detail'],
        weaknesses: ['trust issues', 'workaholic'],
      };
      expect(() => PersonalityTraitsSchema.parse(valid)).not.toThrow();
    });

    it('should accept empty object', () => {
      expect(() => PersonalityTraitsSchema.parse({})).not.toThrow();
    });

    it('should reject non-array traits', () => {
      expect(() =>
        PersonalityTraitsSchema.parse({ traits: 'brave' }),
      ).toThrow();
    });

    it('should reject too many traits', () => {
      const tooManyTraits = Array(25).fill('trait');
      expect(() =>
        PersonalityTraitsSchema.parse({ traits: tooManyTraits }),
      ).toThrow();
    });

    it('should reject too long motivations', () => {
      const longMotivation = 'a'.repeat(600);
      expect(() =>
        PersonalityTraitsSchema.parse({ motivations: longMotivation }),
      ).toThrow();
    });
  });

  describe('ClothingStyleSchema', () => {
    it('should accept valid clothing style', () => {
      const valid = {
        defaultOutfit: 'Navy blazer, white shirt, gray slacks',
        style: 'formal',
        colors: ['navy', 'gray', 'white'],
        accessories: ['silver watch', 'small earrings', 'badge'],
      };
      expect(() => ClothingStyleSchema.parse(valid)).not.toThrow();
    });

    it('should accept empty object', () => {
      expect(() => ClothingStyleSchema.parse({})).not.toThrow();
    });

    it('should reject invalid style enum', () => {
      expect(() =>
        ClothingStyleSchema.parse({ style: 'futuristic' }),
      ).toThrow();
    });

    it('should accept valid style enums', () => {
      const styles = [
        'casual',
        'formal',
        'sporty',
        'vintage',
        'fantasy',
        'modern',
      ];
      styles.forEach((style) => {
        expect(() => ClothingStyleSchema.parse({ style })).not.toThrow();
      });
    });

    it('should reject too long defaultOutfit', () => {
      const longOutfit = 'a'.repeat(600);
      expect(() =>
        ClothingStyleSchema.parse({ defaultOutfit: longOutfit }),
      ).toThrow();
    });

    it('should reject too many colors', () => {
      const tooManyColors = Array(15).fill('color');
      expect(() =>
        ClothingStyleSchema.parse({ colors: tooManyColors }),
      ).toThrow();
    });
  });

  describe('CreateCharacterSchema', () => {
    it('should accept minimal valid input', () => {
      const valid = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John Doe',
      };
      expect(() => CreateCharacterSchema.parse(valid)).not.toThrow();
    });

    it('should accept full input', () => {
      const valid = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Jane Doe',
        description: 'A skilled detective with a mysterious past',
        fileUrl: 'https://example.com/image.png',
        thumbnailUrl: 'https://example.com/thumb.png',
        voiceAssetId: '223e4567-e89b-12d3-a456-426614174001',
        physicalAttributes: {
          age: 28,
          gender: 'female',
          ethnicity: 'East Asian',
          build: 'athletic',
        },
        personality: {
          traits: ['intelligent', 'cautious'],
          motivations: 'Solve the case',
        },
        clothing: {
          defaultOutfit: 'Professional blazer and slacks',
          style: 'formal',
        },
        backstory: 'Once upon a time in a city far away...',
      };
      expect(() => CreateCharacterSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid projectId', () => {
      expect(() =>
        CreateCharacterSchema.parse({
          projectId: 'invalid-uuid',
          name: 'Test',
        }),
      ).toThrow();
    });

    it('should reject empty name', () => {
      expect(() =>
        CreateCharacterSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          name: '',
        }),
      ).toThrow();
    });

    it('should reject name that is too long', () => {
      const longName = 'a'.repeat(300);
      expect(() =>
        CreateCharacterSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          name: longName,
        }),
      ).toThrow();
    });

    it('should reject invalid URL for fileUrl', () => {
      expect(() =>
        CreateCharacterSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test',
          fileUrl: 'not-a-url',
        }),
      ).toThrow();
    });

    it('should reject too long backstory', () => {
      const longBackstory = 'a'.repeat(2500);
      expect(() =>
        CreateCharacterSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test',
          backstory: longBackstory,
        }),
      ).toThrow();
    });
  });

  describe('UpdateCharacterSchema', () => {
    it('should accept valid update with only characterId', () => {
      const valid = {
        characterId: '123e4567-e89b-12d3-a456-426614174000',
      };
      expect(() => UpdateCharacterSchema.parse(valid)).not.toThrow();
    });

    it('should accept partial updates', () => {
      const valid = {
        characterId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Updated Name',
        description: null, // Can set to null
      };
      expect(() => UpdateCharacterSchema.parse(valid)).not.toThrow();
    });

    it('should accept nullable fields', () => {
      const valid = {
        characterId: '123e4567-e89b-12d3-a456-426614174000',
        fileUrl: null,
        voiceAssetId: null,
        backstory: null,
      };
      expect(() => UpdateCharacterSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid characterId', () => {
      expect(() =>
        UpdateCharacterSchema.parse({ characterId: 'invalid' }),
      ).toThrow();
    });
  });

  describe('ListCharactersSchema', () => {
    it('should accept valid list request', () => {
      const valid = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
      };
      expect(() => ListCharactersSchema.parse(valid)).not.toThrow();
    });

    it('should accept with pagination options', () => {
      const valid = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 25,
        offset: 50,
      };
      expect(() => ListCharactersSchema.parse(valid)).not.toThrow();
    });

    it('should use default values for limit and offset', () => {
      const result = ListCharactersSchema.parse({
        projectId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should reject limit > 100', () => {
      expect(() =>
        ListCharactersSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          limit: 200,
        }),
      ).toThrow();
    });

    it('should reject negative offset', () => {
      expect(() =>
        ListCharactersSchema.parse({
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          offset: -10,
        }),
      ).toThrow();
    });
  });
});
