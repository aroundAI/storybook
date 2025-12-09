// Base types (FILM-201)
export {
  type Asset,
  type AssetType,
  type AssetRow,
  type GetProjectAssetsResponse,
  type DeleteAssetResponse,
  // Legacy character metadata (for backwards compatibility)
  type CharacterMetadata,
  type LocationMetadata,
  type Location,
  type PropMetadata,
  type Prop,
  type VoiceMetadata,
  type Voice,
  mapRowToAsset,
} from './types';

// Extended character types (FILM-202)
export {
  type Character,
  type ListCharactersResponse,
  type CharacterDetailsRow,
} from './types/character.types';

// Base asset schemas (FILM-201)
export {
  AssetTypeSchema,
  CharacterMetadataSchema,
  LocationMetadataSchema,
  PropMetadataSchema,
  VoiceMetadataSchema,
  VoiceSettingsSchema,
  CreateAssetSchema,
  UpdateAssetSchema,
  GetProjectAssetsSchema,
  DeleteAssetSchema,
  GetAssetSchema,
  CreateLocationSchema,
  CreatePropSchema,
  CreateVoiceSchema,
  type CreateAssetInput,
  type UpdateAssetInput,
  type GetProjectAssetsInput,
  type DeleteAssetInput,
  type GetAssetInput,
} from './schemas/asset.schema';

// Extended character schemas (FILM-202)
export {
  PhysicalAttributesSchema,
  PersonalityTraitsSchema,
  ClothingStyleSchema,
  CreateCharacterSchema,
  GetCharacterSchema,
  UpdateCharacterSchema,
  ListCharactersSchema,
  DeleteCharacterSchema,
  CharacterFormSchema,
  type CreateCharacterInput,
  type GetCharacterInput,
  type UpdateCharacterInput,
  type ListCharactersInput,
  type DeleteCharacterInput,
  type CharacterFormData,
  type PhysicalAttributes,
  type PersonalityTraits,
  type ClothingStyle,
} from './schemas/character.schema';

// Constants
export * from './constants';
