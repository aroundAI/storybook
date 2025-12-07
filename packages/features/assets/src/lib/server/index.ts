/**
 * Server-side Asset API
 *
 * Exports queries and mutations for asset management.
 * Use @kit/assets/queries or @kit/assets/mutations for specific imports.
 */

// Re-export queries
export {
  getProjectAssets,
  getAsset,
  isAssetInUse,
  getAssetsByType,
  assetExists,
} from './asset.queries';

// Re-export mutations
export {
  createAssetAction,
  getProjectAssetsAction,
  updateAssetAction,
  deleteAssetAction,
} from './asset.mutations';
