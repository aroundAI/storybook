import { describe, expect, it } from 'vitest';

import {
  AssetTypeSchema,
  CharacterMetadataSchema,
  CreateAssetSchema,
  CreateCharacterSchema,
  CreateLocationSchema,
  CreatePropSchema,
  LocationMetadataSchema,
  PhysicalAttributesSchema,
  PropMetadataSchema,
  UpdateAssetSchema,
  VoiceSettingsSchema,
} from '../src/asset';

describe('Asset Schemas', () => {
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('AssetTypeSchema', () => {
    it('should accept valid asset types', () => {
      expect(AssetTypeSchema.safeParse('character').success).toBe(true);
      expect(AssetTypeSchema.safeParse('location').success).toBe(true);
      expect(AssetTypeSchema.safeParse('prop').success).toBe(true);
    });

    it('should reject invalid asset types', () => {
      expect(AssetTypeSchema.safeParse('vehicle').success).toBe(false);
      expect(AssetTypeSchema.safeParse('').success).toBe(false);
    });
  });

  describe('PhysicalAttributesSchema', () => {
    it('should accept valid physical attributes', () => {
      const validAttributes = {
        age: '30',
        gender: 'male',
        height: '6\'2"',
        build: 'athletic',
        hairColor: 'brown',
        eyeColor: 'blue',
        skinTone: 'fair',
        distinctiveFeatures: 'scar on left cheek',
      };
      expect(PhysicalAttributesSchema.safeParse(validAttributes).success).toBe(
        true,
      );
    });

    it('should accept empty object', () => {
      expect(PhysicalAttributesSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('VoiceSettingsSchema', () => {
    it('should apply defaults', () => {
      const result = VoiceSettingsSchema.parse({});
      expect(result.stability).toBe(0.5);
      expect(result.similarityBoost).toBe(0.75);
      expect(result.style).toBe(0.0);
      expect(result.useSpeakerBoost).toBe(true);
    });

    it('should validate value ranges', () => {
      expect(VoiceSettingsSchema.safeParse({ stability: 1.5 }).success).toBe(
        false,
      );
      expect(VoiceSettingsSchema.safeParse({ stability: -0.1 }).success).toBe(
        false,
      );
      expect(VoiceSettingsSchema.safeParse({ stability: 0.8 }).success).toBe(
        true,
      );
    });

    it('should accept valid provider', () => {
      expect(
        VoiceSettingsSchema.safeParse({ provider: 'elevenlabs' }).success,
      ).toBe(true);
      expect(VoiceSettingsSchema.safeParse({ provider: 'suno' }).success).toBe(
        true,
      );
      expect(
        VoiceSettingsSchema.safeParse({ provider: 'invalid' }).success,
      ).toBe(false);
    });
  });

  describe('CharacterMetadataSchema', () => {
    it('should accept valid character metadata', () => {
      const validMetadata = {
        physicalAttributes: {
          age: '25',
          gender: 'female',
        },
        personality: 'brave and kind',
        backstory: 'A warrior from the north',
        voiceSettings: {
          voiceId: 'voice-123',
          stability: 0.7,
        },
        relationships: [
          {
            characterId: validUUID,
            relationship: 'sister',
          },
        ],
      };
      expect(CharacterMetadataSchema.safeParse(validMetadata).success).toBe(
        true,
      );
    });

    it('should accept empty object', () => {
      expect(CharacterMetadataSchema.safeParse({}).success).toBe(true);
    });
  });

  describe('LocationMetadataSchema', () => {
    it('should accept valid location metadata', () => {
      const validMetadata = {
        setting: 'Medieval castle',
        timeOfDay: 'evening',
        weather: 'stormy',
        atmosphere: 'dark and mysterious',
        lighting: 'low candlelight',
        soundscape: 'howling wind',
      };
      expect(LocationMetadataSchema.safeParse(validMetadata).success).toBe(
        true,
      );
    });

    it('should validate timeOfDay enum', () => {
      expect(
        LocationMetadataSchema.safeParse({ timeOfDay: 'dawn' }).success,
      ).toBe(true);
      expect(
        LocationMetadataSchema.safeParse({ timeOfDay: 'midday' }).success,
      ).toBe(false);
    });

    it('should validate weather enum', () => {
      expect(
        LocationMetadataSchema.safeParse({ weather: 'sunny' }).success,
      ).toBe(true);
      expect(
        LocationMetadataSchema.safeParse({ weather: 'windy' }).success,
      ).toBe(false);
    });
  });

  describe('PropMetadataSchema', () => {
    it('should accept valid prop metadata', () => {
      const validMetadata = {
        category: 'weapon',
        dimensions: '3ft x 6in',
        material: 'steel',
        color: 'silver',
        significance: 'Ancestral sword passed down through generations',
      };
      expect(PropMetadataSchema.safeParse(validMetadata).success).toBe(true);
    });
  });

  describe('CreateAssetSchema', () => {
    it('should accept valid asset data', () => {
      const validAsset = {
        projectId: validUUID,
        type: 'character',
        name: 'John Doe',
        description: 'Main protagonist',
      };
      expect(CreateAssetSchema.safeParse(validAsset).success).toBe(true);
    });

    it('should require projectId, type, and name', () => {
      expect(CreateAssetSchema.safeParse({}).success).toBe(false);
      expect(
        CreateAssetSchema.safeParse({
          projectId: validUUID,
          type: 'character',
        }).success,
      ).toBe(false);
    });

    it('should enforce name length', () => {
      expect(
        CreateAssetSchema.safeParse({
          projectId: validUUID,
          type: 'character',
          name: '',
        }).success,
      ).toBe(false);
      expect(
        CreateAssetSchema.safeParse({
          projectId: validUUID,
          type: 'character',
          name: 'a'.repeat(256),
        }).success,
      ).toBe(false);
    });
  });

  describe('CreateCharacterSchema', () => {
    it('should enforce character type literal', () => {
      const validCharacter = {
        projectId: validUUID,
        type: 'character',
        name: 'Jane Doe',
        metadata: {
          personality: 'curious',
        },
      };
      expect(CreateCharacterSchema.safeParse(validCharacter).success).toBe(
        true,
      );
    });

    it('should reject non-character types', () => {
      const invalidCharacter = {
        projectId: validUUID,
        type: 'location',
        name: 'Jane Doe',
      };
      expect(CreateCharacterSchema.safeParse(invalidCharacter).success).toBe(
        false,
      );
    });
  });

  describe('CreateLocationSchema', () => {
    it('should enforce location type literal', () => {
      const validLocation = {
        projectId: validUUID,
        type: 'location',
        name: 'Castle',
        metadata: {
          setting: 'Medieval',
          timeOfDay: 'night',
        },
      };
      expect(CreateLocationSchema.safeParse(validLocation).success).toBe(true);
    });
  });

  describe('CreatePropSchema', () => {
    it('should enforce prop type literal', () => {
      const validProp = {
        projectId: validUUID,
        type: 'prop',
        name: 'Magic Sword',
        metadata: {
          category: 'weapon',
          material: 'enchanted steel',
        },
      };
      expect(CreatePropSchema.safeParse(validProp).success).toBe(true);
    });
  });

  describe('UpdateAssetSchema', () => {
    it('should require id for update', () => {
      expect(
        UpdateAssetSchema.safeParse({
          name: 'Updated Name',
        }).success,
      ).toBe(false);
    });

    it('should accept partial updates', () => {
      const validUpdate = {
        id: validUUID,
        name: 'Updated Name',
      };
      expect(UpdateAssetSchema.safeParse(validUpdate).success).toBe(true);
    });

    it('should accept update with only id', () => {
      expect(UpdateAssetSchema.safeParse({ id: validUUID }).success).toBe(true);
    });
  });
});
