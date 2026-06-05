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
  checkAssetHashQuery,
} from './asset.queries';

// Re-export asset mutations
export {
  createAssetAction,
  getProjectAssetsAction,
  updateAssetAction,
  deleteAssetAction,
  checkAssetHashAction,
  getAssetAction,
  checkAssetsInUseAction,
  bulkDeleteAssetsAction,
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

// Re-export voice actions (ElevenLabs integration)
export {
  getElevenLabsVoicesAction,
  assignVoiceToCharacterAction,
} from './voice.actions';

export type { ElevenLabsVoice } from './voice.actions';
