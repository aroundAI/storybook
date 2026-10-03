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
export * from './shared/dialogue-lines';
export * from './shared/character-arcs';
export * from './shared/scene-checks';
export * from './screenplay';
export * from './screenplay-refinement';
export * from './dialogue-translation';
export * from './publish-metadata';
export * from './story';
export * from './ideation';
export * from './season-outline';
export * from './season-analysis';
export * from './shots';
export * from './audio-cues';
export * from './fact-extraction';
export * from './episode-summary';
