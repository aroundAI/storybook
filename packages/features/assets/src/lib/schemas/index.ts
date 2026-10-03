export * from './asset.schema';
export * from './location.schema';

// Character schemas - explicitly re-export to avoid conflicts with asset.schema.ts
export {
  // Character-specific schemas (FILM-202)
  PhysicalAttributesSchema as CharacterPhysicalAttributesSchema,
  PersonalityTraitsSchema,
  ClothingStyleSchema,
  CreateCharacterSchema as CreateCharacterWithDetailsSchema,
  UpdateCharacterSchema,
  GetCharacterSchema,
  ListCharactersSchema,
  DeleteCharacterSchema,
  CharacterFormSchema,
  // Type exports
  type PhysicalAttributes,
  type PersonalityTraits,
  type ClothingStyle,
  type CreateCharacterInput,
  type UpdateCharacterInput,
  type GetCharacterInput,
  type ListCharactersInput,
  type DeleteCharacterInput,
  type CharacterFormData,
} from './character.schema';
