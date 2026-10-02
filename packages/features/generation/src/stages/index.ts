/**
 * Importing this module registers every stage. Each stage file calls
 * `registerStage` at load; `@kit/generation` re-exports them, so a caller
 * that imports the package sees the registry filled.
 */
export {
  StoryRefinementOutputSchema,
  StoryRefinementTargetSchema,
  storyRefinementStage,
  type StoryRefinementData,
  type StoryRefinementOutput,
  type StoryRefinementTarget,
} from './story-refinement';
export {
  ASSET_DESCRIPTION_CONTEXT_CHARS,
  AssetDescriptionOutputSchema,
  AssetDescriptionTargetSchema,
  CHARACTER_INSTRUCTIONS,
  LOCATION_INSTRUCTIONS,
  assetDescriptionStage,
  fallbackDescription,
  type AssetDescriptionData,
  type AssetDescriptionOutput,
  type AssetDescriptionTarget,
} from './asset-description';
