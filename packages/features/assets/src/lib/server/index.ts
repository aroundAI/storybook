/**
 * Server-side Asset API
 *
 * Exports queries and mutations for asset management.
 * Use @kit/assets/queries or @kit/assets/mutations for specific imports.
 */

// Re-export asset queries
export {
  getProjectAssets,
  getAsset,
  isAssetInUse,
  getAssetsByType,
  assetExists,
} from './asset.queries';

// Re-export asset mutations
export {
  createAssetAction,
  getProjectAssetsAction,
  updateAssetAction,
  deleteAssetAction,
} from './asset.mutations';

// Re-export character queries (FILM-202)
export {
  getCharacter,
  listCharacters,
  getProjectVoiceAssets,
} from './character.queries';

// Re-export character mutations (FILM-202)
export {
  createCharacterAction,
  getCharacterAction,
  updateCharacterAction,
  listCharactersAction,
  deleteCharacterAction,
} from './character.mutations';
